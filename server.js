require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MongoClient, ObjectId, Binary } = require('mongodb');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { Octokit } = require('@octokit/rest');
const diff_match_patch = require('diff-match-patch');
const dmp = new diff_match_patch.diff_match_patch();
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 6767;

// Track current content and save timeouts per file
const currentContent = {};
const saveTimeouts = {};

app.use((req, res, next) => {
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const client = new MongoClient(process.env.MONGO_URL);
let usersCollection, filesCollection, sessionsCollection;

async function connectMongo() {
  await client.connect();
  const db = client.db('multicode');
  usersCollection = db.collection('users');
  filesCollection = db.collection('files');
  sessionsCollection = db.collection('sessions');
}
connectMongo().catch(console.error);

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await usersCollection.findOne({ username });
    if (!user) return done(null, false);
    const match = await bcrypt.compare(password, user.hash);
    return match ? done(null, user) : done(null, false);
  } catch (err) {
    return done(err);
  }
}));
passport.serializeUser((user, cb) => cb(null, user.username));
passport.deserializeUser(async (username, cb) => {
  try {
    const user = await usersCollection.findOne({ username });
    cb(null, user);
  } catch (err) {
    cb(err);
  }
});

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existing = await usersCollection.findOne({ username });
    if (existing) return res.send('Username already exists.');
    const hash = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ username, hash });
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.status(500).send('Registration error');
  }
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err || !user) return res.status(401).send('Login failed');
    req.logIn(user, (err) => {
      if (err) return res.status(500).send('Login error');
      res.json({ success: true, username: user.username });
    });
  })(req, res, next);
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).send('Logout error');
    res.redirect('/');
  });
});

app.post("/api/files", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  try {
    const { name, type, parentId, sessionId } = req.body;
    const username = req.user.username;

    const file = {
      name,
      type,
      parentId: parentId ? new ObjectId(parentId) : null,
      username,
      sessionId: sessionId || null,
      content: "",
      createdAt: new Date()
    };

    const result = await filesCollection.insertOne(file);
    const newFile = { _id: result.insertedId, ...file };

    if (sessionId) {
      io.to(sessionId).emit('fileCreated', newFile);
    }

    res.json(newFile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/files", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  try {
    const username = req.user.username;
    const parentId = req.query.parentId ? new ObjectId(req.query.parentId) : null;
    const sessionId = req.query.sessionId;

    let query = { parentId };

    if (sessionId) {
      query.sessionId = sessionId;
    } else {
      query.username = username;
    }

    const files = await filesCollection.find(query).toArray();

    for (const file of files) {
      if (file.type === 'folder') {
        const childQuery = { parentId: file._id };
        if (sessionId) {
          childQuery.sessionId = sessionId;
        } else {
          childQuery.username = username;
        }
        file.hasChildren = await filesCollection.countDocuments(childQuery) > 0;
      }
    }

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/files/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  try {
    const fileId = new ObjectId(req.params.id);
    const username = req.user.username;
    const fileToDelete = await filesCollection.findOne({ _id: fileId });

    if (!fileToDelete) {
      return res.status(404).json({ error: 'File not found' });
    }

    const canDelete = fileToDelete.username === username || fileToDelete.sessionId;
    if (!canDelete) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    let deletedCount = 0;
    if (fileToDelete.type === 'folder') {
      const deleteContents = async (parentId) => {
        const contents = await filesCollection.find({ parentId: parentId }).toArray();

        for (const item of contents) {
          if (item.type === 'folder') {
            await deleteContents(item._id);
          }
          await filesCollection.deleteOne({ _id: item._id });
          deletedCount++;
        }
      };
      await deleteContents(fileId);
    }

    const result = await filesCollection.deleteOne({ _id: fileId });
    deletedCount += result.deletedCount;
    res.json({ deleted: deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/files/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  try {
    const { content, name, sessionId, parentId } = req.body;
    const update = {};
    if (content !== undefined) update.content = content;
    if (name !== undefined) update.name = name;
    if (parentId !== undefined) update.parentId = parentId ? new ObjectId(parentId) : null;

    const file = await filesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const canUpdate = file.username === req.user.username || (file.sessionId && sessionId === file.sessionId);
    if (!canUpdate) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const result = await filesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    if (sessionId) {
      io.to(sessionId).emit('fileUpdated', { _id: req.params.id, ...update });
    }

    res.json({ modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/import-file', upload.single('file'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const { sessionId } = req.body;
    const username = req.user.username;
    const fileName = req.file.originalname;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico'];
    const isImage = imageExtensions.includes(ext);

    let fileContent;
    if (isImage) {
      fileContent = req.file.buffer.toString('base64');
    } else {
      fileContent = req.file.buffer.toString('utf8');
    }

    const file = {
      name: fileName,
      type: 'file',
      parentId: null,
      username,
      sessionId: sessionId || null,
      content: fileContent,
      createdAt: new Date()
    };

    const result = await filesCollection.insertOne(file);
    const newFile = { _id: result.insertedId, ...file };

    if (sessionId) {
      io.to(sessionId).emit('fileCreated', newFile);
    }

    res.json({ imported: 1, message: 'File imported successfully' });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to import file: ' + err.message });
  }
});

app.post('/api/import-archive', upload.single('archive'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  if (!req.file) return res.status(400).json({ error: 'No archive file provided' });

  try {
    const { sessionId } = req.body;
    const username = req.user.username;
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;

    let entries = [];
    let isZip = false;

    if (mimeType === 'application/zip' || originalName.toLowerCase().endsWith('.zip')) {
      isZip = true;
      const zip = new AdmZip(buffer);
      entries = zip.getEntries().map(entry => ({
        name: entry.entryName,
        isDirectory: entry.isDirectory,
        getData: () => entry.getData()
      }));
    } else {
      return res.status(400).json({ error: 'Unsupported archive format. Only ZIP files are supported for now.' });
    }

    let importedCount = 0;
    const folderMap = new Map();

    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const pathParts = entry.name.split('/').filter(p => p);
      if (pathParts.length === 0) continue;

      let currentParentId = null;

      for (let i = 0; i < pathParts.length - (entry.isDirectory ? 0 : 1); i++) {
        const folderPath = pathParts.slice(0, i + 1).join('/');
        if (!folderMap.has(folderPath)) {
          const folder = {
            name: pathParts[i],
            type: 'folder',
            parentId: currentParentId,
            username,
            sessionId: sessionId || null,
            content: '',
            createdAt: new Date()
          };

          const result = await filesCollection.insertOne(folder);
          const newFolder = { _id: result.insertedId, ...folder };
          folderMap.set(folderPath, newFolder._id);

          if (sessionId) {
            io.to(sessionId).emit('fileCreated', newFolder);
          }

          importedCount++;
        }
        currentParentId = folderMap.get(folderPath);
      }

      if (!entry.isDirectory) {
        const fileName = pathParts[pathParts.length - 1];
        const fileContent = entry.getData().toString('utf8');

        const file = {
          name: fileName,
          type: 'file',
          parentId: currentParentId,
          username,
          sessionId: sessionId || null,
          content: fileContent,
          createdAt: new Date()
        };

        const result = await filesCollection.insertOne(file);
        const newFile = { _id: result.insertedId, ...file };

        if (sessionId) {
          io.to(sessionId).emit('fileCreated', newFile);
        }

        importedCount++;
      }
    }

    res.json({ imported: importedCount, message: 'Archive imported successfully' });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to import archive: ' + err.message });
  }
});

app.post('/api/import-github', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');

  try {
    const { repoUrl, token, sessionId } = req.body;
    const username = req.user.username;

    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required' });
    }

    const urlMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?\/?$/);
    if (!urlMatch) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }

    const [, owner, repo] = urlMatch;

    const octokit = new Octokit({
      auth: token || undefined
    });

    const fetchContents = async (path = '', parentId = null) => {
      try {
        const response = await octokit.repos.getContent({
          owner,
          repo,
          path
        });

        const items = Array.isArray(response.data) ? response.data : [response.data];
        let importedCount = 0;

        for (const item of items) {
          if (item.type === 'dir') {
            const folder = {
              name: item.name,
              type: 'folder',
              parentId,
              username,
              sessionId: sessionId || null,
              content: '',
              createdAt: new Date()
            };

            const result = await filesCollection.insertOne(folder);
            const newFolder = { _id: result.insertedId, ...folder };

            if (sessionId) {
              io.to(sessionId).emit('fileCreated', newFolder);
            }

            importedCount++;
            const subCount = await fetchContents(item.path, newFolder._id);
            importedCount += subCount;
          } else if (item.type === 'file') {
            const fileResponse = await octokit.repos.getContent({
              owner,
              repo,
              path: item.path
            });

            const content = Buffer.from(fileResponse.data.content, 'base64').toString('utf8');
            const file = {
              name: item.name,
              type: 'file',
              parentId,
              username,
              sessionId: sessionId || null,
              content,
              createdAt: new Date()
            };

            const result = await filesCollection.insertOne(file);
            const newFile = { _id: result.insertedId, ...file };

            if (sessionId) {
              io.to(sessionId).emit('fileCreated', newFile);
            }

            importedCount++;
          }
        }

        return importedCount;
      } catch (error) {
        console.error(`Error fetching contents for path ${path}:`, error.message);
        return 0;
      }
    };

    const importedCount = await fetchContents();

    res.json({
      imported: importedCount,
      message: 'GitHub repository imported successfully',
      repo: `${owner}/${repo}`
    });
  } catch (err) {
    console.error('GitHub import error:', err);

    if (err.status === 404) {
      return res.status(404).json({ error: 'Repository not found or access denied' });
    } else if (err.status === 403) {
      return res.status(403).json({ error: 'API rate limit exceeded or access forbidden. Try providing a GitHub token.' });
    } else if (err.status === 401) {
      return res.status(401).json({ error: 'Invalid GitHub token' });
    }
    res.status(500).json({ error: 'Failed to import GitHub repository: ' + err.message });
  }
});

app.get('/api/export-archive', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');

  try {
    const { sessionId } = req.query;
    const username = req.user.username;

    let query = {};
    if (sessionId) {
      query.sessionId = sessionId;
    } else {
      query.username = username;
    }

    const allFiles = await filesCollection.find(query).toArray();

    // Build file tree
    const fileMap = {};
    const rootFiles = [];

    allFiles.forEach(file => {
      file.children = [];
      fileMap[file._id.toString()] = file;
    });

    allFiles.forEach(file => {
      if (file.parentId) {
        const parent = fileMap[file.parentId.toString()];
        if (parent) {
          parent.children.push(file);
        }
      } else {
        rootFiles.push(file);
      }
    });

    // Create ZIP archive
    const zip = new AdmZip();

    function addFilesToZip(files, currentPath = '') {
      files.forEach(file => {
        const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name;

        if (file.type === 'folder') {
          // Add directory
          zip.addFile(fullPath + '/', Buffer.from(''), '');
          // Recursively add children
          addFilesToZip(file.children, fullPath);
        } else {
          // Add file content
          zip.addFile(fullPath, Buffer.from(file.content || '', 'utf8'), '', 0o644);
        }
      });
    }

    addFilesToZip(rootFiles);

    // Generate ZIP buffer
    const zipBuffer = zip.toBuffer();

    // Set headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="multicode-export.zip"');
    res.setHeader('Content-Length', zipBuffer.length);

    res.send(zipBuffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export archive: ' + err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '/')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/app', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public/app.html'));
});

const wrap = (mw) => (socket, next) => mw(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));
io.use((socket, next) => socket.request.user ? next() : next(new Error('unauthorized')));

io.on('connection', (socket) => {
  const username = socket.request.user?.username;
  if (!username) return;

  console.log(`User ${username} connected`);
  socket.userId = null;

  socket.on('joinSession', (sessionId) => {
    socket.join(sessionId);
    console.log(`User ${username} joined session ${sessionId}`);
  });

  socket.on('leaveSession', (sessionId) => {
    socket.leave(sessionId);
    console.log(`User ${username} left session ${sessionId}`);
  });

  socket.on('fileContentUpdate', async (data) => {
    const { sessionId, fileId, patches } = data;
    if (!currentContent[fileId]) {
      try {
        const file = await filesCollection.findOne({ _id: new ObjectId(fileId) });
        currentContent[fileId] = file ? file.content || "" : "";
      } catch (err) {
        console.error('Error loading file content:', err);
        return;
      }
    }

    // Apply patches to current content
    try {
      const patchObjects = dmp.patch_fromText(patches);
      const results = dmp.patch_apply(patchObjects, currentContent[fileId]);
      currentContent[fileId] = results[0];
    } catch (err) {
      console.error('Error applying patches:', err);
      return;
    }

    // Broadcast instantly to other users
    socket.to(sessionId).emit('fileContentUpdated', { fileId, patches });

    // Clear existing timeout and set new one for saving
    if (saveTimeouts[fileId]) {
      clearTimeout(saveTimeouts[fileId]);
    }

    saveTimeouts[fileId] = setTimeout(async () => {
      try {
        await filesCollection.updateOne(
          { _id: new ObjectId(fileId) },
          { $set: { content: currentContent[fileId] } }
        );
        console.log(`Saved content for file ${fileId}`);
      } catch (err) {
        console.error('Error saving file content:', err);
      } finally {
        delete saveTimeouts[fileId];
      }
    }, 5000);
  });

  socket.on('cursorMove', (data) => {
    const { sessionId, userId, fileId, position } = data;
    socket.userId = userId;
    socket.to(sessionId).emit('cursorUpdate', { userId, fileId, position, userName: username });
  });

  socket.on('disconnect', () => {
    console.log(`User ${username} disconnected`);
    if (socket.userId) {
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.to(room).emit('userDisconnected', socket.userId);
        }
      });
    }
  });
});

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection at:', promise, 'reason:', reason));

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));