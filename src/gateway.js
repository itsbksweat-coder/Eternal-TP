const DISCORD_GATEWAY_URL =
  "https://gateway.discord.gg/?v=10&encoding=json";

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
    this.firstHeartbeatTimer = null;
    this.reconnectTimer = null;

    this.sequence = null;
    this.sessionId = null;
    this.resumeGatewayUrl = null;

    this.lastHeartbeatAck = true;
    this.connecting = false;

    // ========================================================
    // DIAGNOSTICS
    // ========================================================

    this.lastError = null;
    this.lastCloseCode = null;
    this.lastCloseReason = null;
    this.lastEvent = null;
    this.lastGatewayOp = null;
    this.lastGatewayEvent = null;
    this.connectedAt = null;
    this.readyAt = null;
  }

  // ==========================================================
  // DURABLE OBJECT HTTP
  // ==========================================================

  async fetch(request) {
    const url = new URL(request.url);

    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    if (url.pathname === "/start") {
      try {
        await this.ensureConnected();

        return Response.json({
          ok: true,

          connected:
            this.socket?.readyState ===
            WebSocket.OPEN,

          readyState:
            this.socket?.readyState ??
            null,

          connecting:
            this.connecting,

          hasDiscordToken:
            Boolean(
              this.env.DISCORD_TOKEN
            ),

          lastError:
            this.lastError,

          lastEvent:
            this.lastEvent
        });
      } catch (error) {
        this.recordError(error);

        return Response.json(
          {
            ok: false,

            error:
              this.lastError,

            hasDiscordToken:
              Boolean(
                this.env.DISCORD_TOKEN
              )
          },
          {
            status: 500
          }
        );
      }
    }

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    if (url.pathname === "/status") {
      return Response.json({
        ok: true,

        connected:
          this.socket?.readyState ===
          WebSocket.OPEN,

        readyState:
          this.socket?.readyState ??
          null,

        connecting:
          this.connecting,

        sessionId:
          this.sessionId,

        sequence:
          this.sequence,

        hasDiscordToken:
          Boolean(
            this.env.DISCORD_TOKEN
          ),

        lastError:
          this.lastError,

        lastCloseCode:
          this.lastCloseCode,

        lastCloseReason:
          this.lastCloseReason,

        lastEvent:
          this.lastEvent,

        lastGatewayOp:
          this.lastGatewayOp,

        lastGatewayEvent:
          this.lastGatewayEvent,

        connectedAt:
          this.connectedAt,

        readyAt:
          this.readyAt
      });
    }

    // --------------------------------------------------------
    // RECONNECT
    // --------------------------------------------------------

    if (url.pathname === "/reconnect") {
      this.lastError = null;
      this.lastCloseCode = null;
      this.lastCloseReason = null;

      this.cleanupSocket();

      try {
        await this.connect();

        return Response.json({
          ok: true,

          connected:
            this.socket?.readyState ===
            WebSocket.OPEN,

          connecting:
            this.connecting,

          lastError:
            this.lastError,

          lastEvent:
            this.lastEvent
        });
      } catch (error) {
        this.recordError(error);

        return Response.json(
          {
            ok: false,
            error:
              this.lastError
          },
          {
            status: 500
          }
        );
      }
    }

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }

  // ==========================================================
  // ERROR HELPER
  // ==========================================================

  recordError(error) {
    this.lastError =
      error instanceof Error
        ? error.message
        : String(error);

    this.lastEvent =
      "error";

    console.error(
      "Eternal TP Gateway error:",
      error
    );
  }

  // ==========================================================
  // ENSURE CONNECTED
  // ==========================================================

  async ensureConnected() {
    if (
      this.socket &&
      (
        this.socket.readyState ===
          WebSocket.OPEN ||
        this.socket.readyState ===
          WebSocket.CONNECTING
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
  // BUILD GATEWAY URL
  // ==========================================================

  getGatewayUrl() {
    // Fresh Discord connection
    if (!this.resumeGatewayUrl) {
      return DISCORD_GATEWAY_URL;
    }

    // Discord normally provides resume_gateway_url as wss://.
    // Cloudflare's fetch() WebSocket upgrade expects HTTPS.
    const base =
      String(
        this.resumeGatewayUrl
      )
        .replace(
          /^wss:/i,
          "https:"
        )
        .replace(
          /^ws:/i,
          "http:"
        )
        .replace(
          /\/+$/,
          ""
        );

    return (
      `${base}/?v=10&encoding=json`
    );
  }

  // ==========================================================
  // CONNECT
  // ==========================================================

  async connect() {
    if (!this.env.DISCORD_TOKEN) {
      this.recordError(
        new Error(
          "DISCORD_TOKEN is missing."
        )
      );

      return;
    }

    if (this.connecting) {
      return;
    }

    this.connecting = true;

    this.lastEvent =
      "connecting";

    this.lastError =
      null;

    this.clearReconnect();

    try {
      const gatewayUrl =
        this.getGatewayUrl();

      console.log(
        "Connecting to Discord Gateway:",
        gatewayUrl
      );

      // ======================================================
      // CLOUDFLARE OUTBOUND WEBSOCKET
      //
      // Important:
      // fetch() receives HTTPS here, not WSS.
      // ======================================================

      const response =
        await fetch(
          gatewayUrl,
          {
            headers: {
              Upgrade:
                "websocket"
            }
          }
        );

      console.log(
        "Discord Gateway upgrade status:",
        response.status
      );

      if (
        response.status !== 101
      ) {
        throw new Error(
          `Discord Gateway returned HTTP ${response.status}.`
        );
      }

      const socket =
        response.webSocket;

      if (!socket) {
        throw new Error(
          "Discord Gateway upgrade succeeded but no WebSocket was returned."
        );
      }

      socket.accept();

      this.socket =
        socket;

      this.connecting =
        false;

      this.connectedAt =
        Date.now();

      this.lastEvent =
        "websocket_connected";

      console.log(
        "Discord Gateway WebSocket connected."
      );

      // ======================================================
      // MESSAGE
      // ======================================================

      socket.addEventListener(
        "message",
        event => {
          this.handleMessage(
            event.data
          ).catch(error => {
            this.recordError(
              error
            );
          });
        }
      );

      // ======================================================
      // CLOSE
      // ======================================================

      socket.addEventListener(
        "close",
        event => {
          this.lastCloseCode =
            event.code;

          this.lastCloseReason =
            event.reason ||
            null;

          this.lastEvent =
            "closed";

          console.log(
            "Discord Gateway closed:",
            event.code,
            event.reason
          );

          this.socket =
            null;

          this.connecting =
            false;

          this.clearHeartbeat();

          // --------------------------------------------------
          // Authentication failed
          // --------------------------------------------------

          if (
            event.code === 4004
          ) {
            this.lastError =
              "Discord Gateway authentication failed (4004). Check DISCORD_TOKEN.";

            console.error(
              this.lastError
            );

            return;
          }

          // --------------------------------------------------
          // Invalid sequence
          // --------------------------------------------------

          if (
            event.code === 4007
          ) {
            this.sessionId =
              null;

            this.sequence =
              null;

            this.resumeGatewayUrl =
              null;
          }

          // --------------------------------------------------
          // Session timed out
          // --------------------------------------------------

          if (
            event.code === 4009
          ) {
            this.sessionId =
              null;

            this.sequence =
              null;

            this.resumeGatewayUrl =
              null;
          }

          // --------------------------------------------------
          // Invalid intents
          // --------------------------------------------------

          if (
            event.code === 4013
          ) {
            this.lastError =
              "Discord rejected the Gateway intents (4013).";

            return;
          }

          // --------------------------------------------------
          // Disallowed intents
          // --------------------------------------------------

          if (
            event.code === 4014
          ) {
            this.lastError =
              "Discord rejected privileged Gateway intents (4014).";

            return;
          }

          this.scheduleReconnect();
        }
      );

      // ======================================================
      // ERROR
      // ======================================================

      socket.addEventListener(
        "error",
        event => {
          this.lastEvent =
            "websocket_error";

          this.lastError =
            "Discord Gateway WebSocket error.";

          console.error(
            "Discord Gateway WebSocket error:",
            event
          );
        }
      );
    } catch (error) {
      this.connecting =
        false;

      this.recordError(
        error
      );

      this.scheduleReconnect();
    }
  }

  // ==========================================================
  // HANDLE DISCORD PAYLOAD
  // ==========================================================

  async handleMessage(raw) {
    let payload;

    try {
      if (
        typeof raw === "string"
      ) {
        payload =
          JSON.parse(raw);
      } else {
        payload =
          JSON.parse(
            new TextDecoder()
              .decode(raw)
          );
      }
    } catch (error) {
      throw new Error(
        `Unable to parse Discord Gateway payload: ${error}`
      );
    }

    const {
      op,
      d,
      s,
      t
    } = payload;

    this.lastGatewayOp =
      op;

    if (t) {
      this.lastGatewayEvent =
        t;
    }

    if (
      s !== null &&
      s !== undefined
    ) {
      this.sequence =
        s;
    }

    // ========================================================
    // DISPATCH
    // ========================================================

    if (op === 0) {
      // ------------------------------------------------------
      // READY
      // ------------------------------------------------------

      if (t === "READY") {
        this.sessionId =
          d?.session_id ||
          null;

        this.resumeGatewayUrl =
          d?.resume_gateway_url ||
          null;

        this.readyAt =
          Date.now();

        this.lastEvent =
          "ready";

        this.lastError =
          null;

        console.log(
          "Eternal TP Discord Gateway READY"
        );

        console.log(
          "Logged in as:",
          d?.user?.username ||
          "unknown"
        );

        this.setOnlinePresence();

        return;
      }

      // ------------------------------------------------------
      // RESUMED
      // ------------------------------------------------------

      if (t === "RESUMED") {
        this.readyAt =
          Date.now();

        this.lastEvent =
          "resumed";

        this.lastError =
          null;

        console.log(
          "Discord Gateway session resumed."
        );

        this.setOnlinePresence();

        return;
      }

      return;
    }

    // ========================================================
    // DISCORD REQUESTED HEARTBEAT
    // ========================================================

    if (op === 1) {
      this.sendHeartbeat();

      return;
    }

    // ========================================================
    // RECONNECT
    // ========================================================

    if (op === 7) {
      this.lastEvent =
        "discord_requested_reconnect";

      this.cleanupSocket();

      this.scheduleReconnect(
        1000
      );

      return;
    }

    // ========================================================
    // INVALID SESSION
    // ========================================================

    if (op === 9) {
      const resumable =
        Boolean(d);

      this.lastEvent =
        "invalid_session";

      if (!resumable) {
        this.sessionId =
          null;

        this.sequence =
          null;

        this.resumeGatewayUrl =
          null;
      }

      this.cleanupSocket();

      this.scheduleReconnect(
        3000
      );

      return;
    }

    // ========================================================
    // HELLO
    // ========================================================

    if (op === 10) {
      this.lastEvent =
        "hello";

      const interval =
        Number(
          d?.heartbeat_interval
        );

      if (
        !Number.isFinite(
          interval
        ) ||
        interval <= 0
      ) {
        throw new Error(
          "Discord returned an invalid heartbeat interval."
        );
      }

      console.log(
        "Discord HELLO received. Heartbeat:",
        interval
      );

      this.startHeartbeat(
        interval
      );

      if (
        this.sessionId &&
        this.sequence !== null
      ) {
        console.log(
          "Attempting Discord session resume."
        );

        this.sendResume();
      } else {
        console.log(
          "Identifying with Discord."
        );

        this.sendIdentify();
      }

      return;
    }

    // ========================================================
    // HEARTBEAT ACK
    // ========================================================

    if (op === 11) {
      this.lastHeartbeatAck =
        true;

      this.lastEvent =
        "heartbeat_ack";

      if (
        this.heartbeatTimeout
      ) {
        clearTimeout(
          this.heartbeatTimeout
        );

        this.heartbeatTimeout =
          null;
      }
    }
  }

  // ==========================================================
  // IDENTIFY
  // ==========================================================

  sendIdentify() {
    const sent =
      this.send({
        op: 2,

        d: {
          token:
            this.env.DISCORD_TOKEN,

          intents:
            GATEWAY_INTENTS,

          properties: {
            os:
              "linux",

            browser:
              "eternal-tp",

            device:
              "eternal-tp"
          },

          presence: {
            since:
              null,

            activities: [
              {
                name:
                  "Eternal TP",

                // 3 = Watching
                type: 3
              }
            ],

            status:
              "online",

            afk:
              false
          }
        }
      });

    if (sent) {
      this.lastEvent =
        "identify_sent";

      console.log(
        "Discord IDENTIFY sent."
      );
    }
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  sendResume() {
    const sent =
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

    if (sent) {
      this.lastEvent =
        "resume_sent";

      console.log(
        "Discord RESUME sent."
      );
    }
  }

  // ==========================================================
  // PRESENCE
  // ==========================================================

  setOnlinePresence() {
    const sent =
      this.send({
        op: 3,

        d: {
          since:
            null,

          activities: [
            {
              name:
                "Eternal TP",

              // 3 = Watching
              type: 3
            }
          ],

          status:
            "online",

          afk:
            false
        }
      });

    if (sent) {
      console.log(
        "Eternal TP presence set to online."
      );
    }
  }

  // ==========================================================
  // HEARTBEAT
  // ==========================================================

  startHeartbeat(
    interval
  ) {
    this.clearHeartbeat();

    this.lastHeartbeatAck =
      true;

    // Discord recommends jitter for the first heartbeat.
    const firstDelay =
      Math.floor(
        Math.random() *
        interval
      );

    this.firstHeartbeatTimer =
      setTimeout(
        () => {
          this.firstHeartbeatTimer =
            null;

          this.sendHeartbeat();

          this.heartbeatTimer =
            setInterval(
              () => {
                this.sendHeartbeat();
              },
              interval
            );
        },
        firstDelay
      );
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
      this.lastError =
        "Discord did not acknowledge the previous heartbeat.";

      this.lastEvent =
        "heartbeat_ack_missing";

      console.warn(
        this.lastError
      );

      this.cleanupSocket();

      this.scheduleReconnect();

      return;
    }

    this.lastHeartbeatAck =
      false;

    const sent =
      this.send({
        op: 1,

        d:
          this.sequence
      });

    if (!sent) {
      return;
    }

    if (
      this.heartbeatTimeout
    ) {
      clearTimeout(
        this.heartbeatTimeout
      );
    }

    this.heartbeatTimeout =
      setTimeout(
        () => {
          if (
            this.lastHeartbeatAck ===
            false
          ) {
            this.lastError =
              "Discord heartbeat timed out.";

            this.lastEvent =
              "heartbeat_timeout";

            console.warn(
              this.lastError
            );

            this.cleanupSocket();

            this.scheduleReconnect();
          }
        },
        HEARTBEAT_TIMEOUT_MS
      );
  }

  // ==========================================================
  // SEND PAYLOAD
  // ==========================================================

  send(payload) {
    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      this.lastError =
        "Attempted to send a Gateway payload while the WebSocket was not open.";

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
      this.recordError(
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

    this.lastEvent =
      "reconnect_scheduled";

    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer =
            null;

          this.ensureConnected()
            .catch(error => {
              this.recordError(
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
  // HEARTBEAT CLEANUP
  // ==========================================================

  clearHeartbeat() {
    if (
      this.firstHeartbeatTimer
    ) {
      clearTimeout(
        this.firstHeartbeatTimer
      );

      this.firstHeartbeatTimer =
        null;
    }

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

  // ==========================================================
  // SOCKET CLEANUP
  // ==========================================================

  cleanupSocket() {
    this.clearHeartbeat();

    const socket =
      this.socket;

    this.socket =
      null;

    this.connecting =
      false;

    if (socket) {
      try {
        socket.close(
          1000,
          "Reconnect"
        );
      } catch (error) {
        console.warn(
          "Gateway close error:",
          error
        );
      }
    }
  }
}
