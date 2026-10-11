const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync, execFileSync } = require("child_process");

const USERS_FILE = process.env.BESTLA_USERS_FILE || "/etc/config/bestla-users.json";

// API key for authenticated endpoints (health is public)
function loadApiKey() {
  if (process.env.BESTLA_API_KEY) {
    return process.env.BESTLA_API_KEY;
  }
  try {
    return fs.readFileSync("/etc/config/api-key", "utf8").trim();
  } catch (err) {
    console.error("No API key configured (BESTLA_API_KEY or /etc/config/api-key); authenticated endpoints are disabled.");
    return "";
  }
}
const API_KEY = loadApiKey();

function isAuthorized(req) {
  if (!API_KEY) return false;
  const header = req.headers["authorization"] || "";
  const provided = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : (req.headers["x-api-key"] || "");
  const a = Buffer.from(String(provided));
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

// Web login credential store: { "<username>": "<salt_hex>:<scrypt_hash_hex>" }
function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (err) {
    return {};
  }
}

function saveCreds(creds) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function setPassword(name, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  const creds = loadCreds();
  creds[name] = salt.toString("hex") + ":" + hash.toString("hex");
  saveCreds(creds);
}

function verifyPassword(name, password) {
  const entry = loadCreds()[name];
  if (!entry) return false;
  const [saltHex, hashHex] = entry.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function deletePassword(name) {
  const creds = loadCreds();
  if (name in creds) {
    delete creds[name];
    saveCreds(creds);
  }
}

// In-memory sessions (lost on restart)
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return cookies;
}

function getSessionUser(req) {
  const token = parseCookies(req)["bestla_session"];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL_MS });
  // Lazy purge of expired sessions
  for (const [t, s] of sessions) {
    if (s.expires < Date.now()) sessions.delete(t);
  }
  return token;
}

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const RESERVED_USERS = new Set(["root", "aiuser", "slurm", "munge", "mysql", "daemon", "bin", "sys"]);

function userExists(name) {
  try {
    execFileSync("id", [name], { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

function sshKeyInfo(name) {
  try {
    const content = fs.readFileSync(path.join("/home", name, ".ssh", "authorized_keys"), "utf8");
    const count = content.split("\n").filter(line => line.trim().length > 0).length;
    return { installed: count > 0, count };
  } catch (err) {
    return { installed: false, count: 0 };
  }
}

function installSshKey(name, pubKey) {
  const { uid, gid } = getUserIds(name);
  const userSshDir = path.join("/home", name, ".ssh");
  const userAuthKeys = path.join(userSshDir, "authorized_keys");
  fs.mkdirSync(userSshDir, { recursive: true });
  fs.chmodSync(userSshDir, 0o700);
  fs.chownSync(userSshDir, uid, gid);
  fs.appendFileSync(userAuthKeys, pubKey + os.EOL);
  fs.chmodSync(userAuthKeys, 0o600);
  fs.chownSync(userAuthKeys, uid, gid);
}

function createUser(name, pubKey, password) {
  execFileSync("useradd", ["-m", "-s", "/bin/bash", name]);

  setPassword(name, password);

  // Best-effort system password (SSH password auth stays disabled; completeness only)
  try {
    execFileSync("chpasswd", [], { input: `${name}:${password}` });
  } catch (err) {
    console.error(`Could not set system password for ${name}:`, err.message);
  }

  if (pubKey) {
    installSshKey(name, pubKey);
  }

  // Best-effort Slurm registration
  try {
    execFileSync("sacctmgr", ["-i", "add", "user", name, "Account=root"], { stdio: "ignore" });
  } catch (err) {
    console.error(`Could not register ${name} with Slurm:`, err.message);
  }
}

function removeUser(name) {
  // Best-effort Slurm removal
  try {
    execFileSync("sacctmgr", ["-i", "delete", "user", name], { stdio: "ignore" });
  } catch (err) {
    console.error(`Could not remove ${name} from Slurm:`, err.message);
  }

  execFileSync("userdel", ["-r", name]);
  deletePassword(name);
}

// Function to get Jupyter token
function getJupyterToken() {
  try {
    return fs.readFileSync("/etc/config/jupyter-token", "utf8").trim();
  } catch (err) {
    console.error("Could not read Jupyter token:", err.message);
    return "";
  }
}

// Serve the index.html page
function renderIndex(user) {
  const jupyterToken = getJupyterToken();
  const jupyterUrl = jupyterToken
    ? `http://localhost:8888/?token=${jupyterToken}`
    : "http://localhost:8888";

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Services Portal</title>
    <style>
      body { font-family: Arial; text-align: center; margin-top: 100px; background: #f5f5f5; }
      h1 { margin-bottom: 40px; }
      button {
        display: block; width: 200px; margin: 20px auto; padding: 15px;
        font-size: 16px; border: none; border-radius: 8px; cursor: pointer;
        background-color: #007acc; color: white; transition: background 0.3s ease;
      }
      button:hover { background-color: #005fa3; }
    </style>
  </head>
  <body>
    <h1>Virtual Training Environment</h1><br><h3>Welcome, ${user}. Choose a Service</h3>
    <button onclick="window.location.href='/ssh'">SSH Key Installer</button>
    <button onclick="window.location.href='${jupyterUrl}'">JupyterLab</button>
    <p><a href="/logout">Log out</a></p>
  </body>
  </html>
  `;
}

// Serve the login page
function renderLogin(message = "") {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Bestla Login</title>
    <style>
      body { font-family: Arial; text-align: center; margin-top: 100px; background: #f5f5f5; }
      input { margin: 8px; padding: 10px; font-size: 16px; }
      button { padding: 10px 30px; font-size: 16px; border: none; border-radius: 8px;
        cursor: pointer; background-color: #007acc; color: white; }
      button:hover { background-color: #005fa3; }
    </style>
  </head>
  <body>
    <h1>Bestla</h1>
    ${message ? `<p><strong>${message}</strong></p>` : ""}
    <form method="POST" action="/login">
      <input type="text" name="username" placeholder="Username" required><br>
      <input type="password" name="password" placeholder="Password" required><br>
      <button type="submit">Log in</button>
    </form>
  </body>
  </html>
  `;
}

// Serve the SSH key installer form
function renderSSH(user, message = "") {
  const keyInfo = sshKeyInfo(user);
  const keyStatus = keyInfo.installed
    ? `An SSH key is currently installed (${keyInfo.count} key(s)).`
    : "No SSH key installed yet.";
  return `
  <!DOCTYPE html>
  <html>
  <head><title>SSH Key Installer</title></head>
  <body>
    <h1>Install Your SSH Key</h1>
    <p>Installing key for user: <strong>${user}</strong> — ${keyStatus}</p>
    ${message ? `<p><strong>${message}</strong></p>` : ""}
    <form method="POST" action="/ssh">
      <label for="ssh_key">Paste your public SSH key:</label><br>
      <textarea name="ssh_key" id="ssh_key" rows="8" cols="70"
        placeholder="ssh-ed25519 AAAAC3Nza..."></textarea><br><br>
      <button type="submit">Install Key</button>
    </form>
    <p><a href="/">Back to portal</a></p>
  </body>
  </html>
  `;
}

// Helper to get UID/GID of a user
function getUserIds(username) {
  try {
    const uid = parseInt(execSync(`id -u ${username}`).toString().trim());
    const gid = parseInt(execSync(`id -g ${username}`).toString().trim());
    return { uid, gid };
  } catch (err) {
    console.error(`Could not get UID/GID for ${username}:`, err.message);
    // fallback to 1000
    return { uid: 1000, gid: 1000 };
  }
}

// Create server
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/login") {
    if (getSessionUser(req)) {
      redirect(res, "/");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderLogin());

  } else if (req.method === "POST" && req.url === "/login") {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const user = (params.get("username") || "").trim();
      const password = params.get("password") || "";

      if (verifyPassword(user, password)) {
        const token = createSession(user);
        redirect(res, "/", {
          "Set-Cookie": `bestla_session=${token}; HttpOnly; SameSite=Lax; Path=/`
        });
      } else {
        res.writeHead(401, { "Content-Type": "text/html" });
        res.end(renderLogin("Invalid username or password."));
      }
    });

  } else if (req.method === "GET" && req.url === "/logout") {
    const token = parseCookies(req)["bestla_session"];
    if (token) sessions.delete(token);
    redirect(res, "/login", {
      "Set-Cookie": "bestla_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });

  } else if (req.method === "GET" && req.url === "/") {
    const user = getSessionUser(req);
    if (!user) {
      redirect(res, "/login");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderIndex(user));

  } else if (req.method === "GET" && req.url === "/ssh") {
    const user = getSessionUser(req);
    if (!user) {
      redirect(res, "/login");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderSSH(user));

  } else if (req.method === "POST" && req.url === "/ssh") {
    const user = getSessionUser(req);
    if (!user) {
      redirect(res, "/login");
      return;
    }
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const pubKey = (params.get("ssh_key") || "").trim();

      if (pubKey.match(/^(ssh-(rsa|ed25519)|ecdsa-[a-z0-9-]+) /)) {
        try {
          installSshKey(user, pubKey);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(renderSSH(user, "Key successfully added!"));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(renderSSH(user, "Error writing key: " + err.message));
        }
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(renderSSH(user, "Invalid SSH public key format."));
      }
    });

  } else if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok", uptime: process.uptime() });

  } else if (req.method === "POST" && req.url === "/api/users") {
    if (!isAuthorized(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      let params;
      if ((req.headers["content-type"] || "").includes("application/json")) {
        try {
          params = JSON.parse(body || "{}");
        } catch (err) {
          json(res, 400, { error: "Invalid JSON body" });
          return;
        }
      } else {
        params = Object.fromEntries(new URLSearchParams(body));
      }
      const newUser = (params.username || "").trim();
      const pubKey = (params.ssh_key || "").trim();
      const password = params.password || "";

      if (!USERNAME_RE.test(newUser) || RESERVED_USERS.has(newUser)) {
        json(res, 400, { error: "Invalid or reserved username" });
        return;
      }
      if (password.length < 8) {
        json(res, 400, { error: "Password is required (min 8 characters)" });
        return;
      }
      if (pubKey && !pubKey.match(/^(ssh-(rsa|ed25519)|ecdsa-[a-z0-9-]+) /)) {
        json(res, 400, { error: "Invalid SSH public key format." });
        return;
      }
      if (userExists(newUser)) {
        json(res, 409, { error: `User ${newUser} already exists` });
        return;
      }
      try {
        createUser(newUser, pubKey, password);
        json(res, 201, { status: "created", username: newUser });
      } catch (err) {
        json(res, 500, { error: "Error creating user: " + err.message });
      }
    });

  } else if (req.method === "GET" && req.url.startsWith("/api/users/") && req.url.endsWith("/stat")) {
    if (!isAuthorized(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const target = decodeURIComponent(
      req.url.slice("/api/users/".length, -"/stat".length)
    ).trim();

    if (!USERNAME_RE.test(target)) {
      json(res, 400, { error: "Invalid username" });
      return;
    }
    if (!userExists(target)) {
      json(res, 404, { error: `User ${target} not found` });
      return;
    }
    const keyInfo = sshKeyInfo(target);
    json(res, 200, {
      username: target,
      exists: true,
      has_web_password: target in loadCreds(),
      ssh_key_installed: keyInfo.installed,
      ssh_key_count: keyInfo.count
    });

  } else if (req.method === "DELETE" && req.url.startsWith("/api/users/")) {
    if (!isAuthorized(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const target = decodeURIComponent(req.url.slice("/api/users/".length)).trim();

    if (!USERNAME_RE.test(target) || RESERVED_USERS.has(target)) {
      json(res, 400, { error: "Invalid or reserved username" });
      return;
    }
    if (!userExists(target)) {
      json(res, 404, { error: `User ${target} not found` });
      return;
    }
    try {
      removeUser(target);
      json(res, 200, { status: "removed", username: target });
    } catch (err) {
      json(res, 500, { error: "Error removing user: " + err.message });
    }

  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

// Initialization
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Portal running at http://localhost:${PORT}/`);
});
