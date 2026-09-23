# Focused SenseAssist web module

This view distills the supplied `D:\neurobridge-senseassist-source` research prototype into two tasks for the unified public demo:

1. Speech practice: browser speech recognition, editable phrase, spoken model, and transcript-based feedback.
2. Unclear-speech interpretation: human-reviewed text is sent, with explicit consent, to the Maira server relay for a tentative phrase suggestion.

Raw microphone audio is not sent to the relay. The browser's own speech-recognition implementation may use a vendor network service. The Maira suggestion is not a clinical interpretation or a confirmed patient request; a person must verify it before any action. The original research source remains unchanged.
