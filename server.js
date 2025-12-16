require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 6767;

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

  socket.on('fileContentUpdate', (data) => {
    const { sessionId, fileId, patches } = data;
    socket.to(sessionId).emit('fileContentUpdated', { fileId, patches });
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