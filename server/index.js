const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve static files from the React frontend app
app.use(express.static(path.join(__dirname, '../client/dist')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow all in dev
    methods: ["GET", "POST"]
  }
});

let waitingUser = null; // Socket of the user waiting for a partner

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-matchmaking', () => {
    // If user is already in a room or waiting, clean up first
    if (socket.room) {
      socket.leave(socket.room);
      socket.to(socket.room).emit('partner-left');
      socket.room = null;
    }

    if (waitingUser && waitingUser.id === socket.id) {
      return; // Already waiting
    }

    if (waitingUser) {
      // Match found
      const room = `room-${waitingUser.id}-${socket.id}`;
      socket.join(room);
      waitingUser.join(room);

      socket.room = room;
      waitingUser.room = room;

      // Tell one user they are the initiator (will send the offer)
      waitingUser.emit('matched', { initiator: true });
      socket.emit('matched', { initiator: false });

      waitingUser = null;
    } else {
      // Wait for someone
      waitingUser = socket;
    }
  });

  socket.on('next', () => {
    if (socket.room) {
      socket.to(socket.room).emit('partner-left');
      socket.leave(socket.room);
      
      // The partner's cleanup will be handled client-side when they receive 'partner-left'
      // and they can choose to 'join-matchmaking' again.
      socket.room = null;
    } else if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }
    
    // Automatically re-join matchmaking
    if (waitingUser) {
      const room = `room-${waitingUser.id}-${socket.id}`;
      socket.join(room);
      waitingUser.join(room);

      socket.room = room;
      waitingUser.room = room;

      waitingUser.emit('matched', { initiator: true });
      socket.emit('matched', { initiator: false });

      waitingUser = null;
    } else {
      waitingUser = socket;
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(socket.room).emit('offer', data);
  });

  socket.on('answer', (data) => {
    socket.to(socket.room).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(socket.room).emit('ice-candidate', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }
    if (socket.room) {
      socket.to(socket.room).emit('partner-left');
    }
  });
});

// Catch-all to serve the React app
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
