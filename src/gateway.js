const DISCORD_GATEWAY_URL =
  "wss://gateway.discord.gg/?v=10&encoding=json";

const GATEWAY_INTENTS = 0;

const HEARTBEAT_TIMEOUT_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;

export class EternalTPGateway {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.socket = null;

    this.heartbeatTimer = null;
    this.heartbeatTimeout = null;
    this.reconnectTimer = null;

    this.sequence = null;
    this.sessionId = null;
    this.resumeGatewayUrl = null;

    this.lastHeartbeatAck = true;
    this.connecting = false;
  }

  // ==========================================================
  // DURABLE OBJECT FETCH
  // ==========================================================

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      await this.ensureConnected();

      return Response.json({
        ok: true,
        connected:
          this.socket?.readyState === WebSocket.OPEN
      });
    }

    if (url.pathname === "/status") {
      return Response.json({
        ok: true,

        connected:
          this.socket?.readyState === WebSocket.OPEN,

        connecting:
          this.connecting,

        sessionId:
          this.sessionId,

        sequence:
          this.sequence
      });
    }

    if (url.pathname === "/reconnect") {
      this.cleanupSocket();

      await this.connect();

      return Response.json({
        ok: true
      });
    }

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }

  // ==========================================================
  // ENSURE CONNECTION
  // ==========================================================

  async ensureConnected() {
    if (
      this.socket &&
      (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    if (this.connecting) {
      return;
    }

    await this.connect();
  }

  // ==========================================================
  // CONNECT
  // ==========================================================

  async connect() {
    if (!this.env.DISCORD_TOKEN) {
      console.error(
        "DISCORD_TOKEN is missing."
      );

      return;
    }

    if (this.connecting) {
      return;
    }

    this.connecting = true;

    this.clearReconnect();

    try {
      const gatewayUrl =
        this.resumeGatewayUrl
          ? `${this.resumeGatewayUrl}?v=10&encoding=json`
          : DISCORD_GATEWAY_URL;

      const response =
        await fetch(
          gatewayUrl,
          {
            headers: {
              Upgrade: "websocket"
            }
          }
        );

      const socket =
        response.webSocket;

      if (!socket) {
        throw new Error(
          "Discord Gateway did not return a WebSocket."
        );
      }

      socket.accept();

      this.socket = socket;
      this.connecting = false;

      socket.addEventListener(
        "message",
        event => {
          this.handleMessage(
            event.data
          ).catch(error => {
            console.error(
              "Gateway message error:",
              error
            );
          });
        }
      );

      socket.addEventListener(
        "close",
        event => {
          console.log(
            "Discord Gateway closed:",
            event.code,
            event.reason
          );

          this.socket = null;

          this.clearHeartbeat();

          // Invalid session / authentication problems
          if (
            event.code === 4004
          ) {
            console.error(
              "Discord Gateway authentication failed."
            );

            return;
          }

          this.scheduleReconnect();
        }
      );

      socket.addEventListener(
        "error",
        event => {
          console.error(
            "Discord Gateway WebSocket error:",
            event
          );
        }
      );
    } catch (error) {
      this.connecting = false;

      console.error(
        "Discord Gateway connection error:",
        error
      );

      this.scheduleReconnect();
    }
  }

  // ==========================================================
  // MESSAGE HANDLER
  // ==========================================================

  async handleMessage(raw) {
    let payload;

    try {
      payload =
        JSON.parse(raw);
    } catch {
      return;
    }

    const {
      op,
      d,
      s,
      t
    } = payload;

    if (
      s !== null &&
      s !== undefined
    ) {
      this.sequence = s;
    }

    // --------------------------------------------------------
    // HELLO
    // --------------------------------------------------------

    if (op === 10) {
      const interval =
        Number(
          d?.heartbeat_interval
        );

      if (
        !Number.isFinite(interval) ||
        interval <= 0
      ) {
        throw new Error(
          "Invalid heartbeat interval."
        );
      }

      this.startHeartbeat(
        interval
      );

      if (
        this.sessionId &&
        this.sequence !== null
      ) {
        this.sendResume();
      } else {
        this.sendIdentify();
      }

      return;
    }

    // --------------------------------------------------------
    // HEARTBEAT ACK
    // --------------------------------------------------------

    if (op === 11) {
      this.lastHeartbeatAck =
        true;

      if (
        this.heartbeatTimeout
      ) {
        clearTimeout(
          this.heartbeatTimeout
        );

        this.heartbeatTimeout =
          null;
      }

      return;
    }

    // --------------------------------------------------------
    // DISCORD REQUESTS RECONNECT
    // --------------------------------------------------------

    if (op === 7) {
      this.cleanupSocket();
      this.scheduleReconnect();

      return;
    }

    // --------------------------------------------------------
    // INVALID SESSION
    // --------------------------------------------------------

    if (op === 9) {
      const resumable =
        Boolean(d);

      if (!resumable) {
        this.sessionId = null;
        this.sequence = null;
        this.resumeGatewayUrl =
          null;
      }

      this.cleanupSocket();

      this.scheduleReconnect(
        3000
      );

      return;
    }

    // --------------------------------------------------------
    // DISPATCH
    // --------------------------------------------------------

    if (op === 0) {
      if (t === "READY") {
        this.sessionId =
          d?.session_id || null;

        this.resumeGatewayUrl =
          d?.resume_gateway_url ||
          null;

        console.log(
          "Eternal TP Discord Gateway READY"
        );

        console.log(
          "Logged in as:",
          d?.user?.username
        );

        this.setOnlinePresence();

        return;
      }

      if (t === "RESUMED") {
        console.log(
          "Discord Gateway session resumed."
        );

        this.setOnlinePresence();
      }
    }
  }

  // ==========================================================
  // IDENTIFY
  // ==========================================================

  sendIdentify() {
    this.send({
      op: 2,

      d: {
        token:
          this.env.DISCORD_TOKEN,

        intents:
          GATEWAY_INTENTS,

        properties: {
          os: "linux",
          browser: "eternal-tp",
          device: "eternal-tp"
        },

        presence: {
          since: null,

          activities: [
            {
              name: "Eternal TP",
              type: 3
            }
          ],

          status: "online",
          afk: false
        }
      }
    });
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  sendResume() {
    this.send({
      op: 6,

      d: {
        token:
          this.env.DISCORD_TOKEN,

        session_id:
          this.sessionId,

        seq:
          this.sequence
      }
    });
  }

  // ==========================================================
  // PRESENCE
  // ==========================================================

  setOnlinePresence() {
    this.send({
      op: 3,

      d: {
        since: null,

        activities: [
          {
            name: "Eternal TP",
            type: 3
          }
        ],

        status: "online",
        afk: false
      }
    });
  }

  // ==========================================================
  // HEARTBEAT
  // ==========================================================

  startHeartbeat(interval) {
    this.clearHeartbeat();

    // Discord recommends jittering the first heartbeat.
    const firstDelay =
      Math.floor(
        Math.random() *
        interval
      );

    setTimeout(() => {
      this.sendHeartbeat();

      this.heartbeatTimer =
        setInterval(
          () => {
            this.sendHeartbeat();
          },
          interval
        );
    }, firstDelay);
  }

  sendHeartbeat() {
    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    if (
      this.lastHeartbeatAck ===
      false
    ) {
      console.warn(
        "Heartbeat ACK missing. Reconnecting."
      );

      this.cleanupSocket();
      this.scheduleReconnect();

      return;
    }

    this.lastHeartbeatAck =
      false;

    this.send({
      op: 1,
      d: this.sequence
    });

    this.heartbeatTimeout =
      setTimeout(
        () => {
          if (
            this.lastHeartbeatAck ===
            false
          ) {
            console.warn(
              "Discord heartbeat timeout."
            );

            this.cleanupSocket();

            this.scheduleReconnect();
          }
        },
        HEARTBEAT_TIMEOUT_MS
      );
  }

  // ==========================================================
  // SEND
  // ==========================================================

  send(payload) {
    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      return false;
    }

    try {
      this.socket.send(
        JSON.stringify(
          payload
        )
      );

      return true;
    } catch (error) {
      console.error(
        "Gateway send error:",
        error
      );

      return false;
    }
  }

  // ==========================================================
  // RECONNECT
  // ==========================================================

  scheduleReconnect(
    delay =
      RECONNECT_DELAY_MS
  ) {
    if (
      this.reconnectTimer
    ) {
      return;
    }

    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer =
            null;

          this.ensureConnected()
            .catch(error => {
              console.error(
                "Reconnect failed:",
                error
              );
            });
        },
        delay
      );
  }

  clearReconnect() {
    if (
      this.reconnectTimer
    ) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;
    }
  }

  // ==========================================================
  // CLEANUP
  // ==========================================================

  clearHeartbeat() {
    if (
      this.heartbeatTimer
    ) {
      clearInterval(
        this.heartbeatTimer
      );

      this.heartbeatTimer =
        null;
    }

    if (
      this.heartbeatTimeout
    ) {
      clearTimeout(
        this.heartbeatTimeout
      );

      this.heartbeatTimeout =
        null;
    }

    this.lastHeartbeatAck =
      true;
  }

  cleanupSocket() {
    this.clearHeartbeat();

    if (this.socket) {
      try {
        this.socket.close(
          1000,
          "Reconnect"
        );
      } catch {
        // Ignore close errors.
      }

      this.socket = null;
    }

    this.connecting =
      false;
  }
}
