from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import uuid
import os
from config import Config

app = Flask(__name__, static_folder='../frontend', static_url_path='')
app.config.from_object(Config)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', logger=True, engineio_logger=True)

# Store active meetings and participants
active_meetings = {}
meeting_participants = {}

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)

@app.route('/api/create-meeting', methods=['POST'])
def create_meeting():
    meeting_id = str(uuid.uuid4())
    active_meetings[meeting_id] = {
        'created_at': str(uuid.uuid4()),
        'participants': []
    }
    meeting_participants[meeting_id] = []
    
    meeting_url = f"/meeting.html?id={meeting_id}"
    
    return jsonify({
        'success': True,
        'meeting_id': meeting_id,
        'meeting_url': meeting_url
    })

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connected', {'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    
    # Remove user from all meetings
    for meeting_id in list(meeting_participants.keys()):
        if request.sid in meeting_participants[meeting_id]:
            meeting_participants[meeting_id].remove(request.sid)
            emit('participant_left', {
                'sid': request.sid,
                'participant_count': len(meeting_participants[meeting_id])
            }, room=meeting_id, skip_sid=request.sid)

@socketio.on('join_meeting')
def handle_join_meeting(data):
    meeting_id = data.get('meeting_id')
    username = data.get('username', 'Anonymous')
    
    if meeting_id not in active_meetings:
        emit('error', {'message': 'Meeting not found'})
        return
    
    join_room(meeting_id)
    
    if meeting_id not in meeting_participants:
        meeting_participants[meeting_id] = []
    
    meeting_participants[meeting_id].append(request.sid)
    
    # Get list of existing participants (excluding the new joiner)
    existing_participants = [sid for sid in meeting_participants[meeting_id] if sid != request.sid]
    
    # Notify others in the room about new participant
    emit('participant_joined', {
        'sid': request.sid,
        'username': username,
        'participant_count': len(meeting_participants[meeting_id])
    }, room=meeting_id, skip_sid=request.sid)
    
    # Send current participants list to the new user
    emit('meeting_joined', {
        'meeting_id': meeting_id,
        'participants': existing_participants,
        'participant_count': len(meeting_participants[meeting_id]),
        'your_sid': request.sid
    })

@socketio.on('leave_meeting')
def handle_leave_meeting(data):
    meeting_id = data.get('meeting_id')
    
    if meeting_id in meeting_participants and request.sid in meeting_participants[meeting_id]:
        meeting_participants[meeting_id].remove(request.sid)
        leave_room(meeting_id)
        
        emit('participant_left', {
            'sid': request.sid,
            'participant_count': len(meeting_participants[meeting_id])
        }, room=meeting_id)

@socketio.on('audio_stream')
def handle_audio_stream(data):
    meeting_id = data.get('meeting_id')
    audio_data = data.get('audio')
    
    # Broadcast audio to all participants except sender
    emit('audio_received', {
        'sid': request.sid,
        'audio': audio_data
    }, room=meeting_id, skip_sid=request.sid)

@socketio.on('transcription')
def handle_transcription(data):
    meeting_id = data.get('meeting_id')
    text = data.get('text')
    is_final = data.get('is_final', False)
    
    # Broadcast transcription to all participants except sender
    emit('transcription_received', {
        'sid': request.sid,
        'text': text,
        'is_final': is_final,
        'timestamp': data.get('timestamp')
    }, room=meeting_id, skip_sid=request.sid)

@socketio.on('webrtc_offer')
def handle_webrtc_offer(data):
    meeting_id = data.get('meeting_id')
    target_sid = data.get('target')
    offer = data.get('offer')
    
    print(f'Forwarding offer from {request.sid} to {target_sid}')
    emit('webrtc_offer', {
        'offer': offer,
        'sender': request.sid
    }, room=target_sid)

@socketio.on('webrtc_answer')
def handle_webrtc_answer(data):
    target_sid = data.get('target')
    answer = data.get('answer')
    
    print(f'Forwarding answer from {request.sid} to {target_sid}')
    emit('webrtc_answer', {
        'answer': answer,
        'sender': request.sid
    }, room=target_sid)

@socketio.on('webrtc_ice_candidate')
def handle_ice_candidate(data):
    target_sid = data.get('target')
    candidate = data.get('candidate')
    
    print(f'Forwarding ICE candidate from {request.sid} to {target_sid}')
    emit('webrtc_ice_candidate', {
        'candidate': candidate,
        'sender': request.sid
    }, room=target_sid)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
