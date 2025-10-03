// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// In-memory store { deviceId: { lat, lon, ts, usingFallback } }
const devices = {};

// POST /update - ESP32 sends here
app.post('/update', (req, res) => {
  const { deviceId, lat, lon, ts, usingFallback } = req.body || {};
  if (!deviceId || typeof lat !== 'number' && typeof lat !== 'string') {
    return res.status(400).json({ ok: false, error: "invalid payload" });
  }

  const entry = {
    deviceId,
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    ts: ts || Math.floor(Date.now()/1000),
    usingFallback: !!usingFallback
  };
  devices[deviceId] = entry;

  // broadcast to sockets listening for this device
  io.to(deviceId).emit('location', entry);

  console.log(`Updated ${deviceId}: ${entry.lat}, ${entry.lon} fallback:${entry.usingFallback}`);
  res.json({ ok: true });
});

// GET latest for device
app.get('/device/:id', (req, res) => {
  const id = req.params.id;
  if (devices[id]) return res.json({ ok: true, data: devices[id] });
  return res.status(404).json({ ok: false, error: "device not found" });
});

// Simple web client page for manual testing
app.get('/view/:id', (req, res) => {
  const id = req.params.id;
  // serve small HTML that connects via socket.io to get live updates
  res.send(`
<!doctype html>
<html>
<head>
  <title>Tracker - ${id}</title>
</head>
<body>
  <h3>Live Tracker: ${id}</h3>
  <div id="info">connecting...</div>
  <a id="maps" href="#" target="_blank">Open in Google Maps</a>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const DEVICE = "${id}";
    const info = document.getElementById('info');
    const maps = document.getElementById('maps');

    socket.on('connect', () => {
      info.innerText = 'connected to server. subscribing...';
      socket.emit('subscribe', DEVICE);
      // fetch current
      fetch('/device/' + DEVICE).then(r => r.json()).then(j => {
        if (j.ok) updateUi(j.data);
      }).catch(e => {});
    });

    socket.on('location', (data) => {
      updateUi(data);
    });

    function updateUi(d) {
      info.innerText = 'Lat: ' + d.lat + '\\nLon: ' + d.lon + '\\nUpdated: ' + new Date(d.ts * 1000).toLocaleString() + '\\nFallback: ' + d.usingFallback;
      maps.href = "https://www.google.com/maps?q=" + d.lat + "," + d.lon;
      maps.innerText = "Open in Google Maps";
    }
  </script>
</body>
</html>
  `);
});

// socket.io handlers
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('subscribe', (deviceId) => {
    socket.join(deviceId);
    // send current value if exists
    if (devices[deviceId]) {
      socket.emit('location', devices[deviceId]);
    }
  });

  socket.on('disconnect', () => {
    // nothing special
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log('Server listening on', PORT);
  console.log('POST updates to http://<server_ip>:' + PORT + '/update');
  console.log('View device at http://<server_ip>:' + PORT + '/view/<deviceId>');
});