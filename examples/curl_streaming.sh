#!/usr/bin/env bash
# curl examples for supertonic-server.
# Usage:  bash examples/curl_streaming.sh
# Assumes a running server on http://localhost:8788.

set -euo pipefail
HOST="${HOST:-http://localhost:8788}"
mkdir -p out

echo "=== Health"
curl -sS "$HOST/healthz" | python3 -m json.tool

echo
echo "=== List voices"
curl -sS "$HOST/v1/voices" | python3 -m json.tool | head -25

echo
echo "=== Synthesize: MP3 (default response_format)"
curl -sS -X POST "$HOST/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input":"Hello from supertonic server. This is the curl example.","voice":"alloy"}' \
  -o out/curl_alloy.mp3
ls -lh out/curl_alloy.mp3

echo
echo "=== Synthesize: streaming WAV, longer text — pipe to ffplay/mpv to hear it live"
echo "   bash:  curl -sS ... | ffplay -nodisp -autoexit -"
curl -sS -X POST "$HOST/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input":"This is the first sentence. Here is a second one. And a third sentence to prove streaming.","voice":"nova","response_format":"wav","lang":"en"}' \
  -o out/curl_stream.wav
ls -lh out/curl_stream.wav

echo
echo "=== Synthesize: PCM (raw int16 mono @ 44100 Hz) — ideal for voice agents"
curl -sS -X POST "$HOST/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input":"Raw PCM is the lowest-latency format. No container, no decoder.","voice":"M2","response_format":"pcm","lang":"en"}' \
  -o out/curl_pcm.pcm
ls -lh out/curl_pcm.pcm

echo
echo "=== Synthesize: Korean"
curl -sS -X POST "$HOST/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input":"안녕하세요. 오늘 하루도 좋은 하루 보내세요.","voice":"F1","lang":"ko","response_format":"mp3"}' \
  -o out/curl_ko.mp3
ls -lh out/curl_ko.mp3

echo
echo "=== Synthesize: low-step mode for lower latency (total_steps=4)"
curl -sS -X POST "$HOST/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input":"This uses only four diffusion steps for the fastest possible synthesis.","voice":"alloy","total_steps":4,"response_format":"mp3"}' \
  -o out/curl_fast.mp3
ls -lh out/curl_fast.mp3

echo
echo "Done. Outputs in ./out/"
