# Audio Message Support

## Goal
Enable AIvaro to process voice messages (audio attachments) as input, transcribing them and feeding the text into the command/LLM pipeline.

## User Stories

### Story 1: Voice Message Input
As a user, I can send a voice message to AIvaro and it will transcribe and process my request.

### Story 2: Hands-Free Interaction
As a user, I can interact with AIvaro while away from keyboard by sending voice messages.

### Story 3: Multi-Modal Conversations
As a user, I can mix text and voice messages in a conversation with AIvaro.

---

## Scope

### In Scope
- Audio attachment detection in Discord messages
- Transcription service integration (Whisper API or local Whisper)
- Transcribed text fed into existing command/LLM pipeline
- Support common audio formats (mp3, wav, ogg, m4a)
- Discord voice message format support

### Out of Scope
- Text-to-speech responses (v2)
- Real-time voice channel interaction
- Audio processing/editing

---

## Architecture

### Transcription Options

| Option | Pros | Cons |
|--------|------|------|
| OpenAI Whisper API | High quality, no local setup | Cost per minute, API dependency |
| Local Whisper | No cost, offline | Requires GPU for speed, model download |
| Other APIs (AssemblyAI, etc.) | Alternatives | Additional dependencies |

**Recommendation**: Start with OpenAI Whisper API, add local option later.

### Flow
```
Discord audio attachment
    ↓
Download audio file
    ↓
Send to transcription service
    ↓
Receive transcribed text
    ↓
Feed into command parser / LLM
    ↓
Respond in text
```

---

## Configuration

```env
AIVARO_AUDIO_ENABLED=true
AIVARO_AUDIO_TRANSCRIPTION_PROVIDER=whisper-api
AIVARO_AUDIO_MAX_DURATION_SECONDS=300
AIVARO_AUDIO_MAX_FILE_SIZE_MB=25
OPENAI_API_KEY=<key>  # if using Whisper API
```

---

## Tasks

### Task 1: Audio Attachment Detection
- Detect audio attachments in Discord messages
- Support Discord voice message format
- Validate file size and duration limits

### Task 2: Audio Download
- Download audio attachment to temp location
- Handle Discord CDN URLs
- Clean up after processing

### Task 3: Transcription Service
- Create `TranscriptionService` interface
- Implement Whisper API client
- Handle errors and retries
- Return transcribed text

### Task 4: Integration with Command Pipeline
- Feed transcribed text to command parser
- Maintain conversation context
- Handle as if user typed the text

### Task 5: Local Whisper Option (Optional)
- Add local Whisper integration
- Model management (download, cache)
- GPU detection and fallback

---

## Acceptance Criteria

- [ ] Audio attachment detected in Discord message
- [ ] Audio file downloaded and sent to transcription
- [ ] Transcribed text processed as command/query
- [ ] Response delivered in text
- [ ] Error handling for transcription failures
- [ ] File size and duration limits enforced
