#!/usr/bin/env bash
# 用 macOS 自带 TTS 生成 16k/16bit/单声道 测试音频 test-audio/sample.wav
set -e
cd "$(dirname "$0")/.."
mkdir -p test-audio
TEXT="${1:-你好，我们这个项目下周三之前能完成第一版吗？另外预算方面你们有什么考虑？}"
say -v Tingting "$TEXT" -o test-audio/sample.aiff
afconvert -f WAVE -d LEI16@16000 -c 1 test-audio/sample.aiff test-audio/sample.wav
rm test-audio/sample.aiff
echo "generated test-audio/sample.wav"
