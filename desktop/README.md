# Oneiro Desktop App

Native macOS SwiftUI app for the Oneiro Cognitive Architecture.

## Features
- Chat with SSE streaming
- Cognitive dashboard (CRM, emotions, goals, hypotheses)
- Perception view (active apps, battery, audio)
- Mind panel (undercurrents, dreams, thought chains)
- Dark purple/blue theme with ambient animations

## Requirements
- macOS 14+
- Xcode 16+
- [xcodegen](https://github.com/yonaskolb/XcodeGen) (for generating .xcodeproj)

## Setup
```bash
# Install xcodegen
brew install xcodegen

# Generate Xcode project
cd desktop/
xcodegen generate

# Build
xcodebuild -project OneiroApp.xcodeproj -scheme OneiroApp build
```

## Dependencies
- [Alamofire](https://github.com/Alamofire/Alamofire) (HTTP client)

## Connection
Connects to OCA backend at `localhost:3333`.
