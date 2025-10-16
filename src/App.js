import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import Video, { createLocalVideoTrack, createLocalAudioTrack } from "twilio-video";
import { Client as ConversationsClient } from "@twilio/conversations";

const API_URL = "https://fastapi-twilio-web3-953848937405.us-central1.run.app";

function App() {
  const [username, setUsername] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [room, setRoom] = useState(null);
  const [localTracks, setLocalTracks] = useState([]);
  const [participants, setParticipants] = useState([]);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [conversationsStatus, setConversationsStatus] = useState("disconnected");

  const conversationsClientRef = useRef(null);
  const userConversationRef = useRef(null);

  // ---------------- INITIALIZE TWILIO CONVERSATIONS ----------------
  const initializeConversations = async (token, conversationSid) => {
    try {
      console.log("🔌 Initializing Twilio Conversations...");
      console.log("📋 Conversation SID:", conversationSid);
      
      const client = new ConversationsClient(token);
      conversationsClientRef.current = client;

      client.on("initialized", async () => {
        console.log("✅ Conversations Client initialized");
        setConversationsStatus("connected");

        try {
          // Use getConversationByUniqueName instead of deprecated method
          const conversation = await client.getConversationByUniqueName(conversationSid);
          userConversationRef.current = conversation;
          console.log("✅ Got conversation:", conversationSid);

          // Join the conversation if not already a participant
          try {
            await conversation.join();
            console.log("✅ Joined conversation as participant");
          } catch (joinErr) {
            console.log("ℹ️ Already a participant or join not needed:", joinErr.message);
          }

          // Listen for incoming messages
          conversation.on("messageAdded", handleIncomingMessage);
          console.log("✅ Listening for messages on conversation");

        } catch (err) {
          console.error("❌ Failed to get conversation:", err);
          console.error("Error details:", err.message);
        }
      });

      client.on("connectionStateChanged", (state) => {
        console.log("🔄 Connection state:", state);
        if (state === "connected") {
          setConversationsStatus("connected");
        } else if (state === "disconnected") {
          setConversationsStatus("disconnected");
        } else if (state === "error") {
          setConversationsStatus("error");
        }
      });

      client.on("connectionError", (error) => {
        console.error("❌ Connection error:", error);
        setConversationsStatus("error");
      });

      // Listen for conversation updates
      client.on("conversationJoined", (conversation) => {
        console.log("✅ Conversation joined event:", conversation.uniqueName);
      });

      client.on("conversationAdded", (conversation) => {
        console.log("✅ Conversation added:", conversation.uniqueName);
      });

    } catch (err) {
      console.error("❌ Failed to initialize Conversations:", err);
      setConversationsStatus("error");
    }
  };

  // ---------------- HANDLE INCOMING MESSAGES ----------------
  const handleIncomingMessage = async (message) => {
    try {
      const messageBody = message.body;
      console.log("📨 Received raw message:", messageBody);
      console.log("📨 Message author:", message.author);

      // Parse JSON message
      const messageData = JSON.parse(messageBody);
      const messageType = messageData.type;

      console.log("📨 Parsed message type:", messageType, messageData);

      switch (messageType) {
        case "incoming_call":
          console.log("📞 Incoming call from:", messageData.caller);
          setIncomingCall({
            caller: messageData.caller,
            room: messageData.room,
            callType: messageData.call_type,
          });

          // Show browser notification
          if (Notification.permission === "granted") {
            new Notification("Incoming Call", {
              body: `${messageData.caller} is calling you`,
              icon: "/call-icon.png",
            });
          }

          // Play notification sound
          try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(e => console.log("Could not play sound:", e));
          } catch (e) {
            console.log("Audio error:", e);
          }
          break;

        case "call_declined":
          console.log("❌ Call declined by:", messageData.declined_by);
          alert(`${messageData.declined_by} declined your call`);
          break;

        case "online_users_update":
          console.log("👥 Online users update:", messageData.users);
          const users = messageData.users
            .filter((u) => u !== username)
            .map((u) => ({ username: u, status: "online" }));
          setOnlineUsers(users);
          break;

        default:
          console.log("Unknown message type:", messageType);
      }
    } catch (err) {
      console.error("❌ Error parsing message:", err);
      console.error("Raw message body:", message.body);
    }
  };

  // ---------------- LOGIN ----------------
  const login = async () => {
    if (!username.trim() || username.length < 2) {
      alert("Please enter a valid username (at least 2 characters).");
      return;
    }
    try {
      const response = await axios.post(`${API_URL}/login`, {
        username,
        fcm_token: "dummy-token",
      });

      const { token, conversation_sid } = response.data;
      console.log("✅ Login successful");
      console.log("📋 Token received");
      console.log("📋 Conversation SID:", conversation_sid);

      setLoggedIn(true);

      // Initialize Twilio Conversations
      await initializeConversations(token, conversation_sid);

      // Request notification permission
      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        console.log("🔔 Notification permission:", permission);
      }

      // Fetch initial online users
      fetchOnlineUsers();
    } catch (err) {
      console.error("❌ Login error:", err);
      alert("Login failed, try again.");
    }
  };

  // ---------------- FETCH ONLINE USERS ----------------
  const fetchOnlineUsers = async () => {
    try {
      const response = await axios.get(`${API_URL}/online-users`);
      const users = response.data
        .filter((u) => u.username !== username)
        .map((u) => ({ username: u.username, status: u.status }));
      setOnlineUsers(users);
      console.log("👥 Fetched online users:", users);
    } catch (err) {
      console.error("❌ Failed to fetch online users:", err);
    }
  };

  // ---------------- CLEANUP ON UNMOUNT ----------------
  useEffect(() => {
    return () => {
      if (conversationsClientRef.current) {
        conversationsClientRef.current.shutdown();
      }
    };
  }, []);

  // ---------------- AUTO LOGOUT ON CLOSE ----------------
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!loggedIn || !username) return;

      if (conversationsClientRef.current) {
        conversationsClientRef.current.shutdown();
      }

      const logoutUrl = `${API_URL}/logout`;
      const blob = new Blob([JSON.stringify({ username })], {
        type: "application/json",
      });
      navigator.sendBeacon(logoutUrl, blob);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [loggedIn, username]);

  // ---------------- PREPARE LOCAL TRACKS ----------------
  const prepareLocalTracks = async () => {
    const videoTrack = await createLocalVideoTrack();
    const audioTrack = await createLocalAudioTrack();
    setLocalTracks([videoTrack, audioTrack]);
    return [videoTrack, audioTrack];
  };

  // ---------------- START CALL ----------------
  const startCall = async (callee) => {
    try {
      const res = await axios.post(`${API_URL}/start-call`, {
        identity: username,
        room_name: `${username}-${callee}-${Date.now()}`,
        callees: [callee],
        call_type: "video",
      });
      console.log("📞 Starting call to:", callee);
      joinRoom(res.data.token, res.data.room_name);
    } catch (err) {
      console.error("❌ Start call error:", err);
      alert("Failed to start call");
    }
  };

  // ---------------- ADD PARTICIPANT ----------------
  const addParticipant = async (callee) => {
    if (!room) {
      alert("You must be in a call to add participants");
      return;
    }
    try {
      await axios.post(`${API_URL}/add-participant`, {
        room_name: room.name,
        caller_identity: username,
        new_participant: callee,
      });
      alert(`${callee} has been invited to the call`);
    } catch (err) {
      console.error("❌ Add participant error:", err);
      alert("Failed to add participant");
    }
  };

  // ---------------- ACCEPT CALL ----------------
  const acceptCall = async () => {
    if (!incomingCall) return;
    const callToAccept = incomingCall;

    try {
      console.log("✅ Accepting call from:", callToAccept.caller);
      setIncomingCall(null);

      const res = await axios.post(`${API_URL}/join-call`, {
        identity: username,
        room_name: callToAccept.room,
        call_type: "video",
      });

      console.log("✅ Joined call, connecting to room...");
      
      setTimeout(() => {
        joinRoom(res.data.token, res.data.room_name);
      }, 100);
    } catch (err) {
      console.error("❌ Accept call error:", err);
      alert("Failed to join call");
    }
  };

  // ---------------- DECLINE CALL ----------------
  const declineCall = async () => {
    if (!incomingCall) return;
    try {
      console.log("❌ Declining call from:", incomingCall.caller);
      await axios.post(`${API_URL}/decline-call`, {
        room_name: incomingCall.room,
        username,
      });
      setIncomingCall(null);
    } catch (err) {
      console.error("❌ Decline call error:", err);
    }
  };

  // ---------------- JOIN ROOM ----------------
  const joinRoom = async (token, roomName) => {
    if (!token || !roomName) return;

    try {
      console.log("🎥 Joining room:", roomName);
      const tracks = await prepareLocalTracks();
      const [videoTrack, audioTrack] = tracks;

      const twilioRoom = await Video.connect(token, {
        name: roomName,
        tracks,
      });
      setRoom(twilioRoom);
      console.log("✅ Connected to Twilio room");

      await new Promise((resolve) => setTimeout(resolve, 100));

      const localDiv = document.getElementById("local-media");
      const remoteDiv = document.getElementById("remote-media");

      if (!localDiv || !remoteDiv) {
        console.error("❌ Video containers not found in DOM");
        return;
      }

      localDiv.innerHTML = "";
      remoteDiv.innerHTML = "";

      const localVideoElement = videoTrack.attach();
      localVideoElement.style.width = "100%";
      localVideoElement.style.height = "100%";
      localVideoElement.style.objectFit = "cover";
      localDiv.appendChild(localVideoElement);

      const updateParticipants = () => {
        const participantList = Array.from(twilioRoom.participants.values()).map(
          (p) => p.identity
        );
        setParticipants(participantList);
        console.log("👥 Participants:", participantList);
      };

      const attachParticipantTracks = (participant) => {
        console.log("👤 Participant connected:", participant.identity);
        const participantDiv = document.createElement("div");
        participantDiv.id = `participant-${participant.sid}`;
        participantDiv.style.width = "300px";
        participantDiv.style.height = "200px";
        participantDiv.style.background = "#222";
        participantDiv.style.borderRadius = "8px";
        participantDiv.style.overflow = "hidden";
        participantDiv.style.position = "relative";

        const nameTag = document.createElement("div");
        nameTag.innerText = participant.identity;
        nameTag.style.position = "absolute";
        nameTag.style.bottom = "10px";
        nameTag.style.left = "10px";
        nameTag.style.background = "rgba(0,0,0,0.7)";
        nameTag.style.color = "white";
        nameTag.style.padding = "5px 10px";
        nameTag.style.borderRadius = "4px";
        nameTag.style.fontSize = "12px";
        participantDiv.appendChild(nameTag);

        remoteDiv.appendChild(participantDiv);

        participant.tracks.forEach((pub) => {
          if (pub.isSubscribed && pub.track) {
            const element = pub.track.attach();
            element.style.width = "100%";
            element.style.height = "100%";
            element.style.objectFit = "cover";
            participantDiv.appendChild(element);
          }
        });

        participant.on("trackSubscribed", (track) => {
          console.log("📹 Track subscribed:", track.kind);
          const element = track.attach();
          element.style.width = "100%";
          element.style.height = "100%";
          element.style.objectFit = "cover";
          participantDiv.appendChild(element);
        });

        updateParticipants();
      };

      twilioRoom.participants.forEach(attachParticipantTracks);
      twilioRoom.on("participantConnected", attachParticipantTracks);
      twilioRoom.on("participantDisconnected", (participant) => {
        console.log("👤 Participant disconnected:", participant.identity);
        const div = document.getElementById(`participant-${participant.sid}`);
        if (div) div.remove();
        updateParticipants();
      });

      twilioRoom.on("disconnected", () => {
        console.log("📴 Disconnected from room");
        localTracks.forEach((t) => t.stop());
        setRoom(null);
        setParticipants([]);
      });

      updateParticipants();
    } catch (err) {
      console.error("❌ Join room error:", err);
      alert("Failed to join room");
    }
  };

  // ---------------- TOGGLE MUTE ----------------
  const toggleMute = () => {
    const audioTrack = localTracks.find((t) => t.kind === "audio");
    if (audioTrack) {
      if (isMuted) audioTrack.enable();
      else audioTrack.disable();
      setIsMuted(!isMuted);
    }
  };

  // ---------------- TOGGLE CAMERA ----------------
  const toggleCamera = () => {
    const videoTrack = localTracks.find((t) => t.kind === "video");
    if (videoTrack) {
      if (isCameraOff) videoTrack.enable();
      else videoTrack.disable();
      setIsCameraOff(!isCameraOff);
    }
  };

  // ---------------- END CALL ----------------
  const endCall = async () => {
    if (room) {
      room.disconnect();
      localTracks.forEach((track) => track.stop());
      setRoom(null);
      setParticipants([]);
      document.getElementById("local-media").innerHTML = "";
      document.getElementById("remote-media").innerHTML = "";
    }
  };

  const availableUsers = onlineUsers.filter(
    (u) => !participants.includes(u.username)
  );

  const statusColor = {
    connected: "#28a745",
    disconnected: "#6c757d",
    error: "#dc3545",
  }[conversationsStatus];

  // ---------------- UI ----------------
  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      {!loggedIn ? (
        <div style={{ maxWidth: 400, margin: "100px auto", textAlign: "center" }}>
          <h2>Video Call App (Twilio Conversations)</h2>
          <input
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && login()}
            style={{
              width: "100%",
              padding: "10px",
              marginBottom: "10px",
              fontSize: "16px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
          />
          <button
            onClick={login}
            style={{
              width: "100%",
              padding: "10px",
              fontSize: "16px",
              background: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Login
          </button>
        </div>
      ) : (
        <>
          {/* HEADER */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <h3>Welcome, {username}</h3>
            <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: statusColor,
                    animation:
                      conversationsStatus === "connected"
                        ? "pulse 2s infinite"
                        : "none",
                  }}
                ></div>
                <span style={{ fontSize: 14, color: "#666" }}>
                  {conversationsStatus === "connected"
                    ? "Live (Twilio Conversations)"
                    : conversationsStatus === "error"
                    ? "Error"
                    : "Connecting..."}
                </span>
              </div>

              {room && (
                <div
                  style={{
                    background: "#28a745",
                    color: "white",
                    padding: "5px 15px",
                    borderRadius: "20px",
                    fontSize: "14px",
                  }}
                >
                  🟢 In Call ({participants.length + 1} participants)
                </div>
              )}
            </div>
          </div>

          {/* MAIN SECTION */}
          <div style={{ display: "flex", gap: 20 }}>
            {/* LEFT PANEL */}
            <div style={{ flex: "0 0 300px" }}>
              <h4>Online Users ({availableUsers.length})</h4>
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                {availableUsers.length === 0 && (
                  <p style={{ color: "#999" }}>No other users online</p>
                )}
                {availableUsers.map((u) => (
                  <div
                    key={u.username}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px",
                      marginBottom: "5px",
                      background: "#f5f5f5",
                      borderRadius: "4px",
                    }}
                  >
                    <span>{u.username}</span>
                    {!room ? (
                      <button
                        onClick={() => startCall(u.username)}
                        style={{
                          padding: "5px 15px",
                          background: "#007bff",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Call
                      </button>
                    ) : (
                      <button
                        onClick={() => addParticipant(u.username)}
                        style={{
                          padding: "5px 15px",
                          background: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Add
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT PANEL */}
            <div style={{ flex: 1, position: "relative" }}>
              {incomingCall && (
                <div
                  style={{
                    border: "2px solid #dc3545",
                    padding: 20,
                    marginBottom: 20,
                    background: "#ffeaea",
                    borderRadius: "8px",
                    animation: "shake 0.5s",
                  }}
                >
                  <p style={{ fontSize: "18px", margin: "0 0 15px 0" }}>
                    📞 Incoming call from <b>{incomingCall.caller}</b>
                  </p>
                  <button
                    onClick={acceptCall}
                    style={{
                      padding: "10px 20px",
                      background: "#28a745",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginRight: "10px",
                    }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={declineCall}
                    style={{
                      padding: "10px 20px",
                      background: "#dc3545",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Decline
                  </button>
                </div>
              )}

              {room && (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <h4>Room: {room.name}</h4>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          onClick={toggleMute}
                          style={{
                            padding: "10px 15px",
                            background: isMuted ? "#6c757d" : "#007bff",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          {isMuted ? "🔇 Unmute" : "🔊 Mute"}
                        </button>
                        <button
                          onClick={toggleCamera}
                          style={{
                            padding: "10px 15px",
                            background: isCameraOff ? "#6c757d" : "#007bff",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          {isCameraOff ? "📷 Turn On" : "📵 Turn Off"}
                        </button>
                        <button
                          onClick={endCall}
                          style={{
                            padding: "10px 15px",
                            background: "#dc3545",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          End
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* VIDEO GRID */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                      gap: "15px",
                      justifyItems: "center",
                      alignItems: "center",
                      padding: "10px",
                    }}
                  >
                    {/* Local Video */}
                    <div
                      id="local-media"
                      style={{
                        width: "100%",
                        aspectRatio: "4 / 3",
                        borderRadius: "10px",
                        overflow: "hidden",
                        background: "#f0f0f0",
                        position: "relative",
                      }}
                    ></div>

                    {/* Remote Videos */}
                    <div
                      id="remote-media"
                      style={{
                        display: "contents",
                      }}
                    ></div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;