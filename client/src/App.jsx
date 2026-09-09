import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './index.css';

// ICE Servers will be fetched dynamically from Metered.ca


function App() {
  const [started, setStarted] = useState(false);
  const [matching, setMatching] = useState(false);
  const [socket, setSocket] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const startApp = async () => {
    try {
      // 1. Fetch TURN Server Credentials from Metered API
      let fetchedIceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ];
      try {
        const response = await fetch("https://meetstranger.metered.live/api/v1/turn/credentials?apiKey=df19e2e73be5bef0b9a0c6ce67971e7de9f5");
        const data = await response.json();
        if (data && data.length > 0) {
          fetchedIceServers = data;
        }
      } catch (err) {
        console.error("Failed to fetch TURN servers, using fallback STUN", err);
      }

      // 2. Access local media devices
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      setStarted(true);
      setMatching(true);
      
      // 3. Connect to the signaling server. 
      // If deployed together, '/' works. Otherwise, use an environment variable.
      const signalingUrl = import.meta.env.VITE_SIGNALING_URL || '/';
      const newSocket = io(signalingUrl);
      setSocket(newSocket);
      socketRef.current = newSocket;

      setupSocketListeners(newSocket, stream, fetchedIceServers);
      newSocket.emit('join-matchmaking');

    } catch (err) {
      console.error('Error accessing media devices.', err);
      alert('Could not access camera/microphone. Please ensure permissions are granted.');
    }
  };

  const setupSocketListeners = (s, stream, iceServers) => {
    s.on('matched', async ({ initiator }) => {
      setMatching(false);
      createPeerConnection(s, stream, iceServers);

      if (initiator) {
        try {
          const offer = await peerConnectionRef.current.createOffer();
          await peerConnectionRef.current.setLocalDescription(offer);
          s.emit('offer', offer);
        } catch (err) {
          console.error('Error creating offer:', err);
        }
      }
    });

    s.on('offer', async (offer) => {
      if (!peerConnectionRef.current) {
        createPeerConnection(s, stream, iceServers);
      }
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        s.emit('answer', answer);
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    });

    s.on('answer', async (answer) => {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    });

    s.on('ice-candidate', async (candidate) => {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    s.on('partner-left', () => {
      cleanupPeerConnection();
      setMatching(true);
      s.emit('join-matchmaking');
    });
  };

  const createPeerConnection = (s, stream, iceServers) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        s.emit('ice-candidate', event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      } else {
        const inboundStream = new MediaStream([event.track]);
        setRemoteStream(inboundStream);
      }
    };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    peerConnectionRef.current = pc;
  };

  const cleanupPeerConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null);
  };

  const handleNext = () => {
    cleanupPeerConnection();
    setMatching(true);
    if (socketRef.current) {
      socketRef.current.emit('next');
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (peerConnectionRef.current) peerConnectionRef.current.close();
    };
  }, []);

  if (!started) {
    return (
      <div className="start-screen">
        <h1>VidiConnect</h1>
        <p>A premium peer-to-peer random video chat. Meet strangers around the world instantly.</p>
        <button className="start-btn" onClick={startApp}>Start Chatting</button>
      </div>
    );
  }

  return (
    <div className="app-container">
      {matching && (
        <div className="loader-container">
          <div className="spinner"></div>
          <div className="status-text">Looking for someone...</div>
        </div>
      )}
      
      <div className="video-grid">
        <div className="video-wrapper">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">You</div>
        </div>
        
        <div className="video-wrapper remote-video-wrapper">
          {remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline />
          ) : (
            <div style={{ color: '#94a3b8' }}>Waiting for connection...</div>
          )}
          <div className="video-label">Stranger</div>
        </div>
      </div>

      <div className="controls-container">
        <button className={`btn ${audioEnabled ? 'primary' : 'danger'}`} onClick={toggleAudio}>
          {audioEnabled ? 'Mute Mic' : 'Unmute Mic'}
        </button>
        <button className={`btn ${videoEnabled ? 'primary' : 'danger'}`} onClick={toggleVideo}>
          {videoEnabled ? 'Stop Video' : 'Start Video'}
        </button>
        <button className="btn primary" onClick={handleNext} style={{ marginLeft: 'auto' }}>
          Next 
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14"></path>
            <path d="m12 5 7 7-7 7"></path>
          </svg>
        </button>
      </div>
    </div>
  );
}

export default App;
