# P2P Share

**P2P Share** is a high-performance, privacy-focused file transfer application that enables direct peer-to-peer sharing between devices without intermediate storage servers.

![P2P Share Interface](https://via.placeholder.com/800x450.png?text=P2P+Share+Interface)
*(Replace with actual screenshot if available)*

## 🚀 Key Features

-   **Direct Peer-to-Peer**: Files are transferred directly between devices using WebRTC. No data ever touches a server.
-   **No File Size Limits**: Because data streams directly, you can share files of practically any size (TB+), limited only by the sender's upload speed and the receiver's disk space.
-   **Direct-to-Disk Saving**: On supported browsers (Chrome, Edge), files are streamed directly to the hard drive, minimizing memory usage.
-   ** robust Connectivity**:
    -   Multi-provider STUN configuration (Google, Cloudflare, Mozilla, Twilio) for reliable NAT traversal.
    -   Smart ICE restart logic to handle network interruptions.
    -   Automatic reconnection for transient dropouts.
-   **Secure Signaling**: Uses Ably for ephemeral signaling capability. No persistent metadata is stored.
-   **Cross-Platform**: Works on any modern web browser (desktop and mobile).

## 🛠️ Technology Stack

-   **Frontend**: Next.js 14 (App Router), React, TypeScript
-   **Styling**: Vanilla CSS with a focus on performance and glassmorphism aesthetics
-   **P2P Protocol**: WebRTC (RTCPeerConnection, RTCDataChannel)
-   **Signaling**: Ably Realtime (Pub/Sub)
-   **State Management**: React Hooks with Ref-mirrored state for stale-closure-free signaling

## 🏗️ Architecture

1.  **Signaling Phase**:
    -   Sender creates a random Room ID.
    -   Sender connects to Ably and waits for a receiver.
    -   Receiver joins using the Room ID.
    -   Peers exchange SDP offers/answers and ICE candidates via Ably.

2.  **P2P Connection**:
    -   Once ICE candidates are exchanged, a direct `RTCDataChannel` is established.
    -   The Ably connection can be closed or kept for status updates (currently kept for reconnection logic).

3.  **Data Transfer**:
    -   Files are split into 256KB chunks.
    -   Sender pushes chunks with backpressure handling (`bufferedAmountLow`).
    -   Receiver writes chunks to memory or disk (via File System Access API).

## 🏁 Getting Started

### Prerequisites

-   Node.js 18+
-   An Ably API Key (Free tier is sufficient)

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/p2p-share.git
    cd p2p-share
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    Copy `.env.example` to `.env.local`:
    ```bash
    cp .env.example .env.local
    ```
    Edit `.env.local` and add your Ably API key:
    ```env
    ABLY_API_KEY=your_ably_api_key_here
    # TURN servers are optional and currently disabled in code for pure P2P experience
    ```

4.  **Run Development Server**:
    ```bash
    npm run dev
    ```

5.  **Open in Browser**:
    Visit `http://localhost:3000`

## 📖 Usage Guide

### Sending a File
1.  Open the app and select **Sender** mode (default).
2.  Click **Create Share Link**.
3.  Copy the generated link and send it to the recipient.
4.  Once the recipient connects, select a file and click **Send**.

### Receiving a File
1.  Open the share link (or paste the Room ID).
2.  Click **Join Room**.
3.  (Optional for large files) Check **"Use direct-to-disk receive mode"** and click **Prepare Save Location** to save directly to a specific folder.
4.  Wait for the sender to start the transfer.

## 🔒 Privacy & Security

-   **End-to-End Encryption**: WebRTC connections are mandatory encrypted (DTLS/SRTP).
-   **Ephemeral Data**: The signaling server (Ably) only relays small metadata packets (SDP/ICE). It cannot see or store file contents.
-   **No Analytics**: The app does not track user behavior or file metadata.

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit a pull request for any bug fixes or feature enhancements.

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
