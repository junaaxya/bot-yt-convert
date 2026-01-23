#!/usr/bin/env python3
"""
Whisper Transcription Script
Transcribe audio to SRT subtitle file using OpenAI Whisper.

Usage:
    python3 whisper_transcribe.py <input_file> <output_srt> [language]
"""
import sys
import whisper
import torch

def format_time(seconds):
    """Convert seconds to SRT time format (HH:MM:SS,mmm)"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 whisper_transcribe.py <input_file> <output_srt> [language]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_srt = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else None

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    
    print(f"Loading Whisper model (medium)...")
    model = whisper.load_model("medium", device=device)
    
    print(f"Transcribing: {input_file}")
    
    # Best practice settings for better accuracy
    transcribe_options = {
        'word_timestamps': True,      # Enable word-level timestamps
        'condition_on_previous_text': True,  # Use context from previous segments
        'temperature': 0,             # Lower temperature = more deterministic
        'compression_ratio_threshold': 2.4,  # Filter out bad segments
        'no_speech_threshold': 0.6,   # Skip silence/noise
    }
    
    if language:
        transcribe_options['language'] = language
    
    result = model.transcribe(input_file, **transcribe_options)
    
    # Generate SRT file with cleaner segments
    print(f"Generating SRT: {output_srt}")
    with open(output_srt, 'w', encoding='utf-8') as f:
        segment_num = 0
        for seg in result['segments']:
            text = seg['text'].strip()
            
            # Skip empty or very short segments
            if not text or len(text) < 2:
                continue
            
            # Skip segments with low confidence (likely hallucinations)
            if seg.get('no_speech_prob', 0) > 0.5:
                continue
                
            segment_num += 1
            start = format_time(seg['start'])
            end = format_time(seg['end'])
            f.write(f"{segment_num}\n{start} --> {end}\n{text}\n\n")
    
    print(f"Done! Detected language: {result.get('language', 'unknown')}")
    print(f"Total segments: {segment_num}")
    print(output_srt)

if __name__ == '__main__':
    main()
