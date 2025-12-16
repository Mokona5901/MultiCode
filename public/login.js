        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        window.location.href = '/app';
                    }
                } else {
                    alert('Identifiants invalides');
                }
            } catch (error) {
                console.error('Erreur de connexion:', error);
                alert('Erreur lors de la connexion');
            }
        });