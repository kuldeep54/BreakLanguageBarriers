const API_URL = window.location.origin;
let socket;
let meetingId;
let localStream;
let peerConnections = {};
let recognition;
let transcriptionEnabled = false;
let selectedLanguage = 'none';
let isMicOn = true;
let isVideoOn = true;
let ttsEnabled = false;
let speechSynthesis = window.speechSynthesis;
let currentUtterance = null;
let transcriptionHistory = [];
let isRecognitionRunning = false;
let recognitionLanguage = 'en-US';
let availableVoices = [];
let mySocketId = null;

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    meetingId = urlParams.get('id');

    if (!meetingId) {
        showNotification('Invalid meeting link', 'error');
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
        return;
    }

    const shortId = meetingId.substring(0, 8);
    document.getElementById('meetingId').textContent = `ID: ${shortId}`;

    loadVoices();
    
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    initializeSocketConnection();
    initializeMediaDevices();
    initializeSpeechRecognition();
    setupEventListeners();
});

function loadVoices() {
    availableVoices = speechSynthesis.getVoices();
    console.log('Available voices:', availableVoices.length);
}

function initializeSocketConnection() {
    socket = io(API_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('Connected to server with socket ID:', socket.id);
        mySocketId = socket.id;
        socket.emit('join_meeting', {
            meeting_id: meetingId,
            username: 'User_' + Math.random().toString(36).substr(2, 9)
        });
    });

    socket.on('meeting_joined', (data) => {
        console.log('Joined meeting:', data);
        mySocketId = data.your_sid;
        updateParticipantCount(data.participant_count);
        showNotification('Connected to meeting', 'success');
        
        // Connect to existing participants
        if (data.participants && data.participants.length > 0) {
            console.log('Existing participants:', data.participants);
            data.participants.forEach(participantSid => {
                if (participantSid !== mySocketId) {
                    setTimeout(() => {
                        createPeerConnection(participantSid, true);
                    }, 1000);
                }
            });
        }
    });

    socket.on('participant_joined', (data) => {
        console.log('Participant joined:', data);
        updateParticipantCount(data.participant_count);
        showNotification('Someone joined', 'success');
        
        if (data.sid !== mySocketId) {
            addParticipantToGrid(data.sid, data.username);
        }
    });

    socket.on('participant_left', (data) => {
        console.log('Participant left:', data);
        updateParticipantCount(data.participant_count);
        showNotification('Someone left', 'error');
        removeParticipantFromGrid(data.sid);
        
        if (peerConnections[data.sid]) {
            peerConnections[data.sid].close();
            delete peerConnections[data.sid];
        }
    });

    socket.on('webrtc_offer', async (data) => {
        console.log('Received offer from:', data.sender);
        if (data.sender !== mySocketId) {
            await handleWebRTCOffer(data.sender, data.offer);
        }
    });

    socket.on('webrtc_answer', async (data) => {
        console.log('Received answer from:', data.sender);
        if (data.sender !== mySocketId && peerConnections[data.sender]) {
            await handleWebRTCAnswer(data.sender, data.answer);
        }
    });

    socket.on('webrtc_ice_candidate', async (data) => {
        console.log('Received ICE candidate from:', data.sender);
        if (data.sender !== mySocketId && peerConnections[data.sender]) {
            await handleICECandidate(data.sender, data.candidate);
        }
    });

    socket.on('transcription_received', (data) => {
        if (transcriptionEnabled) {
            displayTranscription(data);
        }
    });

    socket.on('audio_received', (data) => {
        if (selectedLanguage === 'none') {
            playReceivedAudio(data.audio);
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showNotification('Connection lost', 'error');
    });

    socket.on('error', (data) => {
        console.error('Socket error:', data);
        showNotification(data.message || 'An error occurred', 'error');
    });
}

function createPeerConnection(remoteSid, shouldCreateOffer) {
    console.log('Creating peer connection with:', remoteSid, 'shouldCreateOffer:', shouldCreateOffer);
    
    if (peerConnections[remoteSid]) {
        console.log('Peer connection already exists for:', remoteSid);
        return peerConnections[remoteSid];
    }

    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[remoteSid] = peerConnection;

    // Add local stream tracks with proper constraints
    if (localStream) {
        localStream.getTracks().forEach(track => {
            const sender = peerConnection.addTrack(track, localStream);
            console.log('Added track to peer connection:', track.kind, 'enabled:', track.enabled);
            
            // Ensure track is enabled
            track.enabled = (track.kind === 'audio' ? isMicOn : isVideoOn);
        });
    }

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
        console.log('Received remote track from:', remoteSid, 'kind:', event.track.kind);
        const remoteStream = event.streams[0];
        
        if (remoteStream) {
            displayRemoteStream(remoteSid, remoteStream);
        }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to:', remoteSid);
            socket.emit('webrtc_ice_candidate', {
                target: remoteSid,
                candidate: event.candidate
            });
        }
    });

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state with', remoteSid, ':', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            showNotification('Connected to participant', 'success');
        } else if (peerConnection.connectionState === 'failed' || 
            peerConnection.connectionState === 'disconnected') {
            console.log('Peer connection failed/disconnected:', remoteSid);
            
            // Try to reconnect
            setTimeout(() => {
                if (peerConnection.connectionState === 'failed') {
                    console.log('Attempting to restart ICE for:', remoteSid);
                    peerConnection.restartIce();
                }
            }, 1000);
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state with', remoteSid, ':', peerConnection.iceConnectionState);
    };

    // Create offer if this peer should initiate
    if (shouldCreateOffer) {
        setTimeout(() => {
            createAndSendOffer(remoteSid, peerConnection);
        }, 500);
    }

    return peerConnection;
}

async function createAndSendOffer(remoteSid, peerConnection) {
    try {
        console.log('Creating offer for:', remoteSid);
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        
        console.log('Sending offer to:', remoteSid);
        socket.emit('webrtc_offer', {
            meeting_id: meetingId,
            target: remoteSid,
            offer: offer
        });
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

async function handleWebRTCOffer(remoteSid, offer) {
    try {
        console.log('Handling offer from:', remoteSid);
        
        let peerConnection = peerConnections[remoteSid];
        if (!peerConnection) {
            peerConnection = createPeerConnection(remoteSid, false);
            addParticipantToGrid(remoteSid, 'User');
        }

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        console.log('Sending answer to:', remoteSid);
        socket.emit('webrtc_answer', {
            target: remoteSid,
            answer: answer
        });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleWebRTCAnswer(remoteSid, answer) {
    try {
        console.log('Handling answer from:', remoteSid);
        const peerConnection = peerConnections[remoteSid];
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function handleICECandidate(remoteSid, candidate) {
    try {
        const peerConnection = peerConnections[remoteSid];
        if (peerConnection && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('Added ICE candidate from:', remoteSid);
        } else {
            console.log('Waiting for remote description before adding ICE candidate');
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function displayRemoteStream(remoteSid, stream) {
    console.log('Displaying remote stream for:', remoteSid);
    let participantElement = document.getElementById(`participant-${remoteSid}`);
    
    if (!participantElement) {
        addParticipantToGrid(remoteSid, 'User');
        participantElement = document.getElementById(`participant-${remoteSid}`);
    }

    if (participantElement) {
        const video = participantElement.querySelector('video');
        if (video) {
            video.srcObject = stream;
            video.play().catch(e => console.error('Error playing remote video:', e));
            
            // Check if video track exists and is enabled
            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];
            
            console.log('Remote stream tracks - Video:', videoTrack ? videoTrack.enabled : 'none', 
                       'Audio:', audioTrack ? audioTrack.enabled : 'none');
            
            // Hide video-off overlay if video track is present and enabled
            const videoOffOverlay = participantElement.querySelector('.video-off-overlay');
            if (videoOffOverlay) {
                if (videoTrack && videoTrack.enabled) {
                    videoOffOverlay.classList.remove('active');
                } else {
                    videoOffOverlay.classList.add('active');
                }
            }
            
            // Listen for track enabled/disabled events
            if (videoTrack) {
                videoTrack.onended = () => {
                    console.log('Remote video track ended');
                    if (videoOffOverlay) {
                        videoOffOverlay.classList.add('active');
                    }
                };
            }
        }
    }
}

async function initializeMediaDevices() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        });

        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.play().catch(e => console.error('Error playing local video:', e));
        }

        startAudioStreaming();

        console.log('Media devices initialized');
        console.log('Local tracks - Video:', localStream.getVideoTracks()[0]?.enabled, 
                   'Audio:', localStream.getAudioTracks()[0]?.enabled);
        showNotification('Camera and microphone ready', 'success');
    } catch (error) {
        console.error('Error accessing media devices:', error);
        showNotification('Camera/microphone access denied', 'error');
        
        const localVideoOff = document.getElementById('localVideoOff');
        if (localVideoOff) {
            localVideoOff.classList.add('active');
        }
    }
}

function startAudioStreaming() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(localStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
        if (isMicOn && socket && socket.connected) {
            const audioData = e.inputBuffer.getChannelData(0);
            const audioArray = Array.from(audioData);
            
            socket.emit('audio_stream', {
                meeting_id: meetingId,
                audio: audioArray
            });
        }
    };
}

function playReceivedAudio(audioArray) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioContext.createBuffer(1, audioArray.length, audioContext.sampleRate);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < audioArray.length; i++) {
        channelData[i] = audioArray[i];
    }
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
}

function initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = recognitionLanguage;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log('Speech recognition started for language:', recognitionLanguage);
            isRecognitionRunning = true;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }

            if (finalTranscript) {
                sendTranscription(finalTranscript, true);
                displayOwnTranscription(finalTranscript, true);
            } else if (interimTranscript) {
                displayOwnTranscription(interimTranscript, false);
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isRecognitionRunning = false;
            
            if (event.error === 'not-allowed') {
                showNotification('Microphone access denied for speech recognition', 'error');
            } else if (event.error === 'no-speech') {
                console.log('No speech detected, restarting...');
                restartRecognition();
            } else if (event.error === 'audio-capture') {
                showNotification('No microphone detected', 'error');
            } else if (event.error === 'network') {
                console.log('Network error, restarting...');
                restartRecognition();
            } else {
                restartRecognition();
            }
        };

        recognition.onend = () => {
            console.log('Speech recognition ended');
            isRecognitionRunning = false;
            restartRecognition();
        };
    } else {
        console.warn('Speech recognition not supported');
        showNotification('Speech recognition not supported in this browser', 'error');
    }
}

function updateRecognitionLanguage(langCode) {
    const langMap = {
        'none': 'en-US',
        'en': 'en-US',
        'es': 'es-ES',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'hi': 'hi-IN',
        'zh': 'zh-CN',
        'ja': 'ja-JP',
        'ar': 'ar-SA',
        'pt': 'pt-BR',
        'ru': 'ru-RU'
    };
    
    const newLang = langMap[langCode] || 'en-US';
    
    if (newLang !== recognitionLanguage) {
        recognitionLanguage = newLang;
        
        if (recognition && isRecognitionRunning) {
            recognition.stop();
            isRecognitionRunning = false;
            
            setTimeout(() => {
                if (recognition) {
                    recognition.lang = recognitionLanguage;
                    if (transcriptionEnabled && isMicOn) {
                        try {
                            recognition.start();
                            console.log('Recognition restarted with new language:', recognitionLanguage);
                        } catch (error) {
                            console.log('Error restarting recognition:', error);
                        }
                    }
                }
            }, 300);
        } else if (recognition) {
            recognition.lang = recognitionLanguage;
        }
    }
}

function restartRecognition() {
    if (isMicOn && transcriptionEnabled && !isRecognitionRunning) {
        setTimeout(() => {
            try {
                if (recognition && !isRecognitionRunning) {
                    recognition.lang = recognitionLanguage;
                    recognition.start();
                    console.log('Speech recognition restarted with language:', recognitionLanguage);
                }
            } catch (error) {
                if (error.name !== 'InvalidStateError') {
                    console.log('Recognition restart error:', error);
                }
            }
        }, 300);
    }
}

function addParticipantToGrid(sid, username) {
    const videoGrid = document.getElementById('videoGrid');
    
    if (document.getElementById(`participant-${sid}`)) {
        console.log('Participant already in grid:', sid);
        return;
    }
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.id = `participant-${sid}`;
    videoContainer.innerHTML = `
        <video class="remote-video" autoplay playsinline></video>
        <div class="video-off-overlay active">
            <div class="participant-avatar">${username.charAt(0).toUpperCase()}</div>
            <p class="participant-name">${username}</p>
        </div>
        <div class="video-overlay">${username}</div>
    `;
    
    videoGrid.appendChild(videoContainer);
}

function removeParticipantFromGrid(sid) {
    const participantElement = document.getElementById(`participant-${sid}`);
    if (participantElement) {
        participantElement.remove();
    }
}

function sendTranscription(text, isFinal) {
    socket.emit('transcription', {
        meeting_id: meetingId,
        text: text,
        is_final: isFinal,
        timestamp: Date.now()
    });
}

function displayOwnTranscription(text, isFinal) {
    if (!transcriptionEnabled) return;
    
    const transcriptionContent = document.getElementById('transcriptionContent');
    const placeholder = transcriptionContent.querySelector('.transcription-placeholder');
    
    if (placeholder) {
        placeholder.remove();
    }

    let existingItem = transcriptionContent.querySelector('.transcription-item.own.interim');
    
    if (isFinal) {
        if (existingItem) {
            existingItem.remove();
        }
        
        const transcriptionItem = document.createElement('div');
        transcriptionItem.className = 'transcription-item own';
        transcriptionItem.setAttribute('data-original', text);
        transcriptionItem.innerHTML = `
            <div class="transcription-speaker">You</div>
            <div class="transcription-text">${escapeHtml(text)}</div>
        `;
        transcriptionContent.appendChild(transcriptionItem);
        
        transcriptionHistory.push({
            element: transcriptionItem,
            originalText: text,
            isOwn: true
        });
        
        setTimeout(() => {
            const items = transcriptionContent.querySelectorAll('.transcription-item');
            if (items.length > 50) {
                items[0].remove();
            }
        }, 100);
    } else {
        if (existingItem) {
            existingItem.querySelector('.transcription-text').textContent = text;
        } else {
            const transcriptionItem = document.createElement('div');
            transcriptionItem.className = 'transcription-item own interim';
            transcriptionItem.innerHTML = `
                <div class="transcription-speaker">You (speaking...)</div>
                <div class="transcription-text">${escapeHtml(text)}</div>
            `;
            transcriptionContent.appendChild(transcriptionItem);
        }
    }

    transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
}

async function displayTranscription(data) {
    if (!transcriptionEnabled) return;
    
    const transcriptionContent = document.getElementById('transcriptionContent');
    const placeholder = transcriptionContent.querySelector('.transcription-placeholder');
    
    if (placeholder) {
        placeholder.remove();
    }

    let text = data.text;
    let originalText = data.text;

    if (selectedLanguage !== 'none' && data.is_final) {
        text = await translateText(text, selectedLanguage);
    }

    if (data.is_final) {
        const transcriptionItem = document.createElement('div');
        transcriptionItem.className = 'transcription-item';
        transcriptionItem.setAttribute('data-original', originalText);
        transcriptionItem.innerHTML = `
            <div class="transcription-speaker">Participant</div>
            <div class="transcription-text">${escapeHtml(text)}</div>
        `;
        transcriptionContent.appendChild(transcriptionItem);
        
        transcriptionHistory.push({
            element: transcriptionItem,
            originalText: originalText,
            isOwn: false
        });
        
        if (ttsEnabled && selectedLanguage !== 'none') {
            speakText(text);
        }
        
        setTimeout(() => {
            const items = transcriptionContent.querySelectorAll('.transcription-item');
            if (items.length > 50) {
                items[0].remove();
            }
        }, 100);
    }

    transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
}

async function translateText(text, targetLang) {
    try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await response.json();
        
        if (data && data[0] && data[0][0] && data[0][0][0]) {
            return data[0][0][0];
        }
    } catch (error) {
        console.error('Translation error:', error);
    }
    
    return text;
}

async function retranslateAllHistory() {
    if (selectedLanguage === 'none') {
        transcriptionHistory.forEach(item => {
            if (!item.isOwn) {
                const textElement = item.element.querySelector('.transcription-text');
                textElement.textContent = item.originalText;
            }
        });
    } else {
        for (const item of transcriptionHistory) {
            if (!item.isOwn) {
                const translatedText = await translateText(item.originalText, selectedLanguage);
                const textElement = item.element.querySelector('.transcription-text');
                textElement.textContent = translatedText;
            }
        }
    }
}

function speakText(text) {
    if (!ttsEnabled || !text.trim()) {
        return;
    }
    
    if (availableVoices.length === 0) {
        loadVoices();
        setTimeout(() => speakText(text), 100);
        return;
    }
    
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    
    currentUtterance = new SpeechSynthesisUtterance(text);
    
    const languageVoiceMap = {
        'en': 'en',
        'es': 'es',
        'fr': 'fr',
        'de': 'de',
        'hi': 'hi',
        'zh': 'zh',
        'ja': 'ja',
        'ar': 'ar',
        'pt': 'pt',
        'ru': 'ru'
    };
    
    let selectedVoice = null;
    
    if (selectedLanguage !== 'none' && languageVoiceMap[selectedLanguage]) {
        const langPrefix = languageVoiceMap[selectedLanguage];
        selectedVoice = availableVoices.find(v => v.lang.startsWith(langPrefix));
        
        if (!selectedVoice) {
            selectedVoice = availableVoices.find(v => v.lang.toLowerCase().includes(langPrefix));
        }
    }
    
    if (!selectedVoice) {
        selectedVoice = availableVoices.find(v => v.lang.startsWith('en')) || availableVoices[0];
    }
    
    if (selectedVoice) {
        currentUtterance.voice = selectedVoice;
    }
    
    currentUtterance.rate = 1.0;
    currentUtterance.pitch = 1.0;
    currentUtterance.volume = 1.0;
    
    currentUtterance.onend = () => {
        console.log('Speech ended');
    };
    
    currentUtterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
    };
    
    speechSynthesis.speak(currentUtterance);
}

function setupEventListeners() {
    const micBtn = document.getElementById('micBtn');
    const videoBtn = document.getElementById('videoBtn');
    const shareScreenBtn = document.getElementById('shareScreenBtn');
    const leaveMeetingBtn = document.getElementById('leaveMeetingBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const transcriptionToggle = document.getElementById('transcriptionToggle');
    const closeSidebar = document.getElementById('closeSidebar');
    const translationLanguageSelect = document.getElementById('translationLanguage');
    const ttsToggle = document.getElementById('ttsToggle');
    const recognitionLanguageSelect = document.getElementById('recognitionLanguage');

    micBtn.addEventListener('click', () => {
        isMicOn = !isMicOn;
        
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = isMicOn;
            }
        }
        
        // Update all peer connections
        Object.values(peerConnections).forEach(pc => {
            const senders = pc.getSenders();
            senders.forEach(sender => {
                if (sender.track && sender.track.kind === 'audio') {
                    sender.track.enabled = isMicOn;
                }
            });
        });
        
        if (isMicOn) {
            micBtn.classList.add('active');
            micBtn.classList.remove('muted');
            document.getElementById('micIcon').textContent = '🎤';
            micBtn.querySelector('.control-tooltip').textContent = 'Mute';
            
            if (recognition && transcriptionEnabled) {
                try {
                    recognition.start();
                } catch (error) {
                    console.log('Recognition already started');
                }
            }
            showNotification('Microphone on', 'success');
        } else {
            micBtn.classList.remove('active');
            micBtn.classList.add('muted');
            document.getElementById('micIcon').textContent = '🎤';
            micBtn.querySelector('.control-tooltip').textContent = 'Unmute';
            
            if (recognition) {
                recognition.stop();
                isRecognitionRunning = false;
            }
            showNotification('Microphone off', 'error');
        }
    });

    videoBtn.addEventListener('click', () => {
        isVideoOn = !isVideoOn;
        
        const localVideo = document.getElementById('localVideo');
        const localVideoOff = document.getElementById('localVideoOff');
        
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = isVideoOn;
            }
        }
        
        // Update all peer connections
        Object.values(peerConnections).forEach(pc => {
            const senders = pc.getSenders();
            senders.forEach(sender => {
                if (sender.track && sender.track.kind === 'video') {
                    sender.track.enabled = isVideoOn;
                }
            });
        });
        
        if (isVideoOn) {
            videoBtn.classList.add('active');
            document.getElementById('videoIcon').textContent = '📹';
            videoBtn.querySelector('.control-tooltip').textContent = 'Turn off camera';
            if (localVideoOff) localVideoOff.classList.remove('active');
            showNotification('Camera on', 'success');
        } else {
            videoBtn.classList.remove('active');
            document.getElementById('videoIcon').textContent = '📹';
            videoBtn.querySelector('.control-tooltip').textContent = 'Turn on camera';
            if (localVideoOff) localVideoOff.classList.add('active');
            showNotification('Camera off', 'error');
        }
    });

    shareScreenBtn.addEventListener('click', async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });
            
            showNotification('Screen sharing started', 'success');
            shareScreenBtn.classList.add('active');
            
            screenStream.getVideoTracks()[0].onended = () => {
                shareScreenBtn.classList.remove('active');
                showNotification('Screen sharing stopped', 'error');
            };
        } catch (error) {
            console.error('Error sharing screen:', error);
            showNotification('Screen sharing cancelled', 'error');
        }
    });

    transcriptionToggle.addEventListener('click', () => {
        transcriptionEnabled = !transcriptionEnabled;
        const sidebar = document.getElementById('transcriptionSidebar');
        
        if (transcriptionEnabled) {
            transcriptionToggle.classList.add('active');
            sidebar.classList.remove('hidden');
            transcriptionToggle.querySelector('.control-tooltip').textContent = 'Turn off captions';
            
            if (recognition && isMicOn) {
                try {
                    recognition.start();
                    console.log('Starting speech recognition for captions');
                } catch (error) {
                    console.log('Recognition already started');
                }
            }
            showNotification('Captions enabled - speak normally', 'success');
        } else {
            transcriptionToggle.classList.remove('active');
            sidebar.classList.add('hidden');
            transcriptionToggle.querySelector('.control-tooltip').textContent = 'Turn on captions';
            
            if (recognition) {
                recognition.stop();
                isRecognitionRunning = false;
            }
            showNotification('Captions disabled', 'error');
        }
    });

    closeSidebar.addEventListener('click', () => {
        transcriptionEnabled = false;
        transcriptionToggle.classList.remove('active');
        document.getElementById('transcriptionSidebar').classList.add('hidden');
        
        if (recognition) {
            recognition.stop();
            isRecognitionRunning = false;
        }
        showNotification('Captions disabled', 'error');
    });

    leaveMeetingBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to leave the meeting?')) {
            leaveMeeting();
        }
    });

    leaveBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to leave the meeting?')) {
            leaveMeeting();
        }
    });

    translationLanguageSelect.addEventListener('change', async (e) => {
        selectedLanguage = e.target.value;
        await retranslateAllHistory();
        
        showNotification(
            selectedLanguage === 'none' 
                ? 'Using original audio - TTS disabled' 
                : `Translating to ${e.target.options[e.target.selectedIndex].text} - TTS will speak translations`,
            'success'
        );
    });

    if (recognitionLanguageSelect) {
        recognitionLanguageSelect.addEventListener('change', (e) => {
            updateRecognitionLanguage(e.target.value);
            showNotification(`Speech recognition set to ${e.target.options[e.target.selectedIndex].text}`, 'success');
        });
    }

    if (ttsToggle) {
        ttsToggle.addEventListener('click', () => {
            ttsEnabled = !ttsEnabled;
            
            if (ttsEnabled) {
                ttsToggle.classList.add('active');
                ttsToggle.querySelector('.control-tooltip').textContent = 'Turn off audio';
                
                loadVoices();
                
                if (selectedLanguage === 'none') {
                    showNotification('TTS enabled, but you must select a translation language for it to work', 'error');
                } else {
                    showNotification('Text-to-speech enabled - incoming messages will be spoken', 'success');
                }
            } else {
                ttsToggle.classList.remove('active');
                ttsToggle.querySelector('.control-tooltip').textContent = 'Turn on audio';
                
                if (speechSynthesis.speaking) {
                    speechSynthesis.cancel();
                }
                showNotification('Text-to-speech disabled', 'error');
            }
        });
    }
}

function leaveMeeting() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    if (recognition) {
        recognition.stop();
        isRecognitionRunning = false;
    }

    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }

    if (socket) {
        socket.emit('leave_meeting', { meeting_id: meetingId });
        socket.disconnect();
    }

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};

    window.location.href = '/';
}

function updateParticipantCount(count) {
    const countElement = document.getElementById('countNumber');
    if (countElement) {
        countElement.textContent = count;
    }
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.addEventListener('beforeunload', () => {
    if (socket && socket.connected) {
        socket.emit('leave_meeting', { meeting_id: meetingId });
    }
});
