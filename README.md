# File Converter

Node/Express file converter using ffmpeg and LibreOffice.
Routes:
- GET / : simple upload page
- POST /convert : upload file + out format

Build: Dockerfile provided (includes ffmpeg & libreoffice).
Start: `node server.js` or `docker run -p 3000:3000 <image>`

⚠️ Warning: large uploads and "no limits" settings are dangerous in production.
