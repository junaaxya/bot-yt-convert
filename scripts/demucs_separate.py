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
            '-n', 'htdemucs_ft',    # Model Fine-Tuned for higher accuracy
            '--two-stems', 'vocals',
            '--shifts', '10',       # 10x random sampling for cleaner separation
            '--overlap', '0.25',    # Smooth transitions
            '-o', output_dir,
            input_file
        ], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        print(f"Detail Error: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    
    # Find output file dynamically (handles htdemucs, htdemucs_ft, or other models)
    base = os.path.splitext(os.path.basename(input_file))[0]
    
    # Demucs creates a subfolder based on the model name
    # We try to find where it is
    possible_folders = ['htdemucs_ft', 'htdemucs', 'mdx_extra_q']
    result_dir = None
    
    for folder in possible_folders:
        candidate = os.path.join(output_dir, folder, base)
        if os.path.exists(candidate):
            result_dir = candidate
            break
            
    if not result_dir:
        # Fallback: check any subdirectory in output_dir
        subdirs = [os.path.join(output_dir, d) for d in os.listdir(output_dir) if os.path.isdir(os.path.join(output_dir, d))]
        for sub in subdirs:
             candidate = os.path.join(sub, base)
             if os.path.exists(candidate):
                 result_dir = candidate
                 break
    
    if not result_dir:
        print(f"Error: Could not find Demucs output directory for base: {base}", file=sys.stderr)
        sys.exit(1)
    
    if stem_type == 'vocals':
        src = os.path.join(result_dir, 'vocals.wav')
        final_name = 'vocals.wav'
    else:
        src = os.path.join(result_dir, 'no_vocals.wav')
        final_name = 'no_vocals.wav'
    
    if not os.path.exists(src):
        print(f"Error: Expected output not found: {src}", file=sys.stderr)
        sys.exit(1)
    
    # Copy to output directory
    final = os.path.join(output_dir, final_name)
    shutil.copy(src, final)
    
    # Cleanup demucs temp files (delete ALL model subfolders found)
    try:
        for folder in os.listdir(output_dir):
            folder_path = os.path.join(output_dir, folder)
            if os.path.isdir(folder_path) and folder != '.' and folder != '..':
                # Only delete if it looks like a demucs model folder (safe check)
                if folder in possible_folders or folder == 'htdemucs_ft':
                     shutil.rmtree(folder_path)
    except Exception as e:
        print(f"Warning: Cleanup failed: {e}", file=sys.stderr)
    
    # Print result path (will be captured by Node.js)
    print(final)

if __name__ == '__main__':
    main()
