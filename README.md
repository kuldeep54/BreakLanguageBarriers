# AnyTalk - Real-time Meeting Platform

AnyTalk is a real-time video meeting platform with live transcription and translation capabilities. Break language barriers and communicate seamlessly with participants speaking different languages.

## Features

- **Real-time Video Meetings**: Connect with multiple participants via WebRTC
- **Live Transcription**: Automatic speech-to-text conversion as you speak
- **Multi-language Translation**: Translate transcriptions to your preferred language
- **Easy Meeting Creation**: Generate and share meeting links instantly
- **Modern UI**: Beautiful interface with custom color scheme

## Color Palette

- Primary Background: #0F0F0F
- Accent Gold: #DCAB69
- Accent Red: #6E0C23
- Accent Brown: #774D23

## Installation

### Prerequisites

- Python 3.8 or higher
- Modern web browser (Chrome, Firefox, Edge)

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Create a virtual environment:
```bash
python -m venv venv
```

3. Activate the virtual environment:

On Windows:
```bash
venv\Scripts\activate
```

On macOS/Linux:
```bash
source venv/bin/activate
```

4. Install dependencies:
```bash
pip install -r requirements.txt
```

5. Run the server:
```bash
python app.py
```

The server will start on `http://localhost:5000`

## Usage

1. Open your browser and navigate to `http://localhost:5000`
2. Click "Generate Meeting Link" to create a new meeting
3. Share the generated link with participants
4. Join the meeting and start communicating

### Transcription Controls

- **Show/Hide**: Toggle transcription visibility
- **Language Dropdown**: Select your preferred translation language
- **Default**: No translation (original language)

### Meeting Controls

- **Microphone**: Mute/Unmute your audio
- **Camera**: Turn video on/off
- **Screen Share**: Share your screen with participants
- **Leave Meeting**: Exit the current meeting

## Browser Compatibility

- Chrome/Edge: Full support (recommended)
- Firefox: Full support
- Safari: Limited support (WebRTC features may vary)

## Technical Stack

### Backend
- Flask: Web framework
- Flask-SocketIO: WebSocket support
- Python-SocketIO: Real-time communication
- Flask-CORS: Cross-origin resource sharing

### Frontend
- HTML5
- CSS3
- Vanilla JavaScript
- Socket.IO Client
- WebRTC API
- Web Speech API

## Project Structure
```
anytalk/
├── backend/
│   ├── app.py              # Main Flask application
│   ├── config.py           # Configuration settings
│   └── requirements.txt    # Python dependencies
│
└── frontend/
    ├── index.html          # Home page
    ├── meeting.html        # Meeting room page
    ├── css/
    │   └── style.css       # All styles
    └── js/
        ├── home.js         # Home page functionality
        └── meeting.js      # Meeting room functionality
```

## Features in Detail

### Real-time Transcription
Uses the Web Speech API to convert speech to text in real-time. The transcription appears as participants speak, with interim results shown in a lighter color.

### Translation
Integrates with Google Translate API to provide real-time translation of transcriptions into multiple languages including:
- English
- Spanish
- French
- German
- Hindi
- Chinese
- Japanese
- Arabic
- Portuguese
- Russian

### WebRTC Communication
Peer-to-peer video and audio communication using WebRTC with STUN servers for NAT traversal.

## Troubleshooting

### Microphone/Camera Not Working
- Grant browser permissions for microphone and camera
- Check if devices are not being used by other applications
- Try refreshing the page

### Transcription Not Appearing
- Ensure microphone is unmuted
- Check browser compatibility (Chrome/Edge recommended)
- Verify microphone permissions

### Translation Not Working
- Check internet connection
- Ensure a language is selected from the dropdown
- Translation only works for final transcriptions

## Security Notes

- All communication happens in real-time
- No data is stored on servers
- Meetings are ephemeral and disappear after all participants leave

## Future Enhancements

- Recording functionality
- Chat messaging
- Screen annotation
- Virtual backgrounds
- Meeting scheduling
- User authentication
- Persistent meeting rooms

## License

This project is open source and available for educational purposes.

## Support

For issues or questions, please check the troubleshooting section or create an issue in the project repository.

---

**Note**: This is a demo application. For production use, implement proper authentication, encryption, and scalability features.