#!/usr/bin/env python3
"""
Demucs Vocal Separator Script
Memisahkan vokal dan instrumen dari file audio menggunakan AI Demucs.

Usage:
    python3 demucs_separate.py <input_file> <output_dir> [vocals|no_vocals]
"""
import sys
import subprocess
import os
import shutil

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 demucs_separate.py <input_file> <output_dir> [vocals|no_vocals]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    stem_type = sys.argv[3] if len(sys.argv) > 3 else 'no_vocals'
    
    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Run demucs dengan model htdemucs (cepat dan bagus)
    # --two-stems vocals = pisahkan jadi vocals + no_vocals saja (lebih cepat)
    try:
        subprocess.run([
            'demucs',
            '-n', 'htdemucs',
            '--two-stems', 'vocals',
            '-o', output_dir,
            input_file
        ], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        print(f"Demucs error: {e.stderr}")
        sys.exit(1)
    
    # Find output file
    base = os.path.splitext(os.path.basename(input_file))[0]
    result_dir = os.path.join(output_dir, 'htdemucs', base)
    
    if stem_type == 'vocals':
        src = os.path.join(result_dir, 'vocals.wav')
        final_name = 'vocals.wav'
    else:
        src = os.path.join(result_dir, 'no_vocals.wav')
        final_name = 'no_vocals.wav'
    
    if not os.path.exists(src):
        print(f"Error: Expected output not found: {src}")
        sys.exit(1)
    
    # Copy to output directory
    final = os.path.join(output_dir, final_name)
    shutil.copy(src, final)
    
    # Cleanup demucs temp files
    try:
        shutil.rmtree(os.path.join(output_dir, 'htdemucs'))
    except:
        pass
    
    # Print result path (will be captured by Node.js)
    print(final)

if __name__ == '__main__':
    main()
