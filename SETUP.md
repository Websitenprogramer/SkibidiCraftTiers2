# SkibidiTiers Setup: MongoDB Atlas + Render (100% kostenlos)

## SCHRITT 1: MongoDB Atlas (Datenbank)

1. https://www.mongodb.com/cloud/atlas/register → Account erstellen
2. "Build a Database" → M0 Free → "Create"
3. Username & Passwort vergeben (merken!)
4. "Allow Access from Anywhere" → "Add IP Address"
5. "Finish and Close"

### Verbindungs-URL holen:
1. "Connect" → "Drivers"
2. URL sieht so aus:
   mongodb+srv://USERNAME:PASSWORT@cluster0.xxxxx.mongodb.net/
3. USERNAME und PASSWORT ersetzen → URL kopieren!

---

## SCHRITT 2: GitHub

1. https://github.com → Account erstellen
2. "New repository" → Name: skibiditiers → "Create"
3. "uploading an existing file" → alle Dateien hochladen:
   - server.js
   - package.json
   - Procfile
   - Ordner "public" mit index.html
4. "Commit changes"

---

## SCHRITT 3: Render

1. https://render.com → Account erstellen
2. "New +" → "Web Service"
3. GitHub verbinden → skibiditiers auswählen
4. Einstellungen:
   - Start Command: node server.js
   - Plan: Free
5. Unten "Environment Variables":
   - Key:   MONGO_URI
   - Value: deine MongoDB URL aus Schritt 1
6. "Create Web Service" → fertig!

Deine URL: https://skibiditiers.onrender.com
