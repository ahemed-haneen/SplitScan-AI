import "dotenv/config";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Essential for sessions to work behind the AI Studio reverse proxy
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: "splitscan-secret",
      resave: false,
      saveUninitialized: true,
      proxy: true, // Required when trust proxy is 1
      cookie: {
        secure: true,
        sameSite: "none",
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      },
    })
  );

  // Splitwise Config
  const CLIENT_ID = process.env.SPLITWISE_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPLITWISE_CLIENT_SECRET;
  const APP_URL = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${PORT}`;
  const CALLBACK_URL = `${APP_URL}/auth/callback`;

  // Auth Status
  app.get("/api/auth/status", (req, res) => {
    let isAuthenticated = !!(req.session as any).splitwiseToken;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      isAuthenticated = true; // Assume valid if present; will throw 401 on actual fetch if invalid
    }
    res.json({ isAuthenticated });
  });

  // Login - Get Auth URL
  app.get("/api/auth/url", (req, res) => {
    if (!CLIENT_ID) {
      return res.status(500).json({ error: "SPLITWISE_CLIENT_ID is not configured in Secrets" });
    }
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      response_type: "code",
    });
    res.json({ url: `https://secure.splitwise.com/oauth/authorize?${params.toString()}` });
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Failed to logout" });
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  // Callback
  app.get("/auth/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send("Authorization code is missing. Please try again.");
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error("Missing Splitwise credentials in server environment");
      return res.status(500).send("Server configuration error: Splitwise Client ID or Secret is missing.");
    }

    try {
      const response = await axios.post("https://secure.splitwise.com/oauth/token", {
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: CALLBACK_URL,
      });

      if (response.data && response.data.access_token) {
        (req.session as any).splitwiseToken = response.data.access_token;
        
        // Manual save to ensure session is persisted before redirect/close
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).send("Failed to save session.");
          }
          
          res.send(`
            <html>
              <head><title>Authentication Successful</title></head>
              <body>
                <script>
                  if (window.opener) {
                    window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: '${response.data.access_token}' }, '*');
                    window.close();
                  } else {
                    window.location.href = '/?token=${response.data.access_token}';
                  }
                </script>
                <p style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                  Authentication successful. You can close this window.
                </p>
              </body>
            </html>
          `);
        });
      } else {
        throw new Error("No access token received from Splitwise");
      }
    } catch (error: any) {
      console.error("Splitwise Token Exchange Error:", error.response?.data || error.message);
      const details = error.response?.data?.error_description || error.message;
      res.status(500).send(`Failed to exchange code for token: ${details}`);
    }
  });

  // Splitwise API Proxy
  app.get("/api/splitwise/:endpoint", async (req, res) => {
    let token = (req.session as any).splitwiseToken;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const { endpoint } = req.params;
    try {
      const response = await axios.get(`https://secure.splitwise.com/api/v3.0/${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: req.query
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/splitwise/create_expense", async (req, res) => {
    let token = (req.session as any).splitwiseToken;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    try {
      const response = await axios.post("https://secure.splitwise.com/api/v3.0/create_expense", req.body, {
        headers: { Authorization: `Bearer ${token}` },
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  // Vite Integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "build");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
