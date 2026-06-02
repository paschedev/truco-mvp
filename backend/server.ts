import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { prisma } from "./db.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ================= TYPES =================
export interface CardPlay {
  userId: string;
  card: string;
}

export interface Score {
  [playerId: string]: number;
}

export interface EnvidoState {
  calls: string[];
  pending: boolean;
  caller: string | null;
}

export interface TrucoState {
  level: number;
  pending: boolean;
  caller: string | null;
  acceptedBy: string | null;
  canRaiseBy: string | null;
}

export interface EnvidoStep {
  playerId: string;
  type: 'points' | 'good';
  value: number | string;
}

export interface LastAction {
  type: 'envido' | 'truco' | 'fold';
  winner: string;
  points: number;
  accepted?: boolean;
  winnerPoints?: number | null;
  envidoPoints?: Record<string, number>;
  envidoSpoken?: Record<string, string | number>;
  envidoSteps?: EnvidoStep[];
  resolutionId?: number;
}

export interface ResponseBubble {
  playerId: string;
  text: string;
  id: number;
}

export interface GameState {
  id: string;
  players: string[];
  turnOrder: string[];
  hands: Record<string, string[]>;
  initialHands: Record<string, string[]>;
  table: CardPlay[];
  currentTrick: CardPlay[];
  history: string[];
  turn: string;
  mano: string;
  winner: string | null;
  firstCardPlayed: Record<string, boolean>;
  score: Score;
  matchWinner: string | null;
  envido: EnvidoState | null;
  envidoPlayed: boolean;
  truco: TrucoState;
  lastAction: LastAction | null;
  responseBubble: ResponseBubble | null;
}

export interface User {
  id: string;
  username: string;
}

const games: Record<string, GameState> = {};

// Helper to send emails via Resend API
async function sendVerificationEmail(email: string, token: string) {
  // Siempre imprimir el código en la consola del servidor como respaldo/desarrollo
  console.log(`📨 [Código de verificación] Para: ${email} -> Código: ${token}`);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "re_PLACEHOLDER") {
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Truco Argentino <onboarding@resend.dev>",
        to: email,
        subject: "Verifica tu cuenta - Truco Argentino",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #2e7d32; text-align: center;">Truco Argentino</h2>
            <p>¡Hola!</p>
            <p>Gracias por registrarte en nuestra plataforma de Truco. Tu código de verificación de 6 dígitos es:</p>
            <div style="font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; padding: 15px; background-color: #f1f8e9; border-radius: 5px; color: #2e7d32; margin: 20px 0;">
              ${token}
            </div>
            <p>Ingresá este código en la aplicación para activar tu cuenta.</p>
            <p style="color: #777; font-size: 12px; margin-top: 30px;">Si no solicitaste este registro, podés ignorar este correo.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("❌ Error al enviar mail con Resend:", errText);
    } else {
      console.log("📨 Correo enviado con éxito a", email);
    }
  } catch (e) {
    console.error("❌ Excepción al enviar mail con Resend:", e);
  }
}

interface AuthenticatedRequest extends express.Request {
  user?: {
    id: string;
    username: string;
  };
}

function authenticateToken(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No autorizado: Token faltante" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string };
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(403).json({ error: "Token inválido o expirado" });
  }
}

// ================= REGISTRO =================
app.post("/auth/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    });

    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ error: "El nombre de usuario ya está en uso" });
      }
      return res.status(400).json({ error: "El correo electrónico ya está registrado" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const tokenVal = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        verified: false,
        verificationToken: tokenVal,
      }
    });

    // Enviar el correo en segundo plano para no demorar la respuesta al cliente
    sendVerificationEmail(email, tokenVal).catch(err => {
      console.error("❌ Error en segundo plano al enviar mail:", err);
    });
    res.json({ message: "Usuario registrado con éxito. Por favor, verifica tu correo." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno del servidor al registrar" });
  }
});

// ================= VERIFICAR DISPONIBILIDAD DE USUARIO Y CORREO =================
app.post("/auth/check-availability", async (req, res) => {
  const { username, email } = req.body;

  if (!username || !email) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    });

    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ error: "El nombre de usuario ya está en uso" });
      }
      return res.status(400).json({ error: "El correo electrónico ya está registrado" });
    }

    res.json({ available: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al verificar disponibilidad" });
  }
});

// ================= VERIFICAR CUENTA =================
app.post("/auth/verify", async (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ error: "Correo y código son requeridos" });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email, verificationToken: token }
    });

    if (!user) {
      return res.status(400).json({ error: "Código de verificación inválido" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verified: true,
        verificationToken: null
      }
    });

    res.json({ message: "Cuenta verificada con éxito. Ya podés iniciar sesión." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno al verificar cuenta" });
  }
});

// ================= REENVIAR CÓDIGO DE VERIFICACIÓN =================
app.post("/auth/resend-code", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "El correo electrónico es requerido" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(404).json({ error: "No existe un usuario registrado con este correo" });
    }

    if (user.verified) {
      return res.status(400).json({ error: "Esta cuenta ya ha sido verificada" });
    }

    const tokenVal = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.user.update({
      where: { id: user.id },
      data: { verificationToken: tokenVal }
    });

    sendVerificationEmail(email, tokenVal).catch(err => {
      console.error("❌ Error en segundo plano al reenviar mail:", err);
    });

    res.json({ message: "Se ha reenviado un nuevo código de verificación a tu correo." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno al reenviar el código" });
  }
});

// ================= INICIAR SESIÓN =================
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Usuario y contraseña son requeridos" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      return res.status(400).json({ error: "Usuario o contraseña incorrectos" });
    }

    /*
    if (!user.verified) {
      return res.status(403).json({ error: "Cuenta no verificada", email: user.email });
    }
    */

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(400).json({ error: "Usuario o contraseña incorrectos" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        coins: user.coins,
        wins: user.wins,
        losses: user.losses,
        avatarUrl: user.avatarUrl,
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno al iniciar sesión" });
  }
});

// ================= OBTENER PERFIL ACTUAL =================
app.get("/auth/me", authenticateToken, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "No autorizado" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        coins: user.coins,
        wins: user.wins,
        losses: user.losses,
        avatarUrl: user.avatarUrl,
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno al obtener perfil" });
  }
});

// ================= CAMBIAR CONTRASEÑA =================
app.post("/auth/change-password", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!req.user) return res.status(401).json({ error: "No autorizado" });

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Contraseña actual y nueva son obligatorias" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return res.status(400).json({ error: "La contraseña actual es incorrecta" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    res.json({ message: "Contraseña actualizada con éxito" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno al cambiar contraseña" });
  }
});

// ================= ACTUALIZAR AVATAR =================
app.post("/auth/update-avatar", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { avatarUrl } = req.body;
  if (!req.user) return res.status(401).json({ error: "No autorizado" });

  if (!avatarUrl) {
    return res.status(400).json({ error: "El avatarUrl es requerido" });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl }
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        coins: user.coins,
        wins: user.wins,
        losses: user.losses,
        avatarUrl: user.avatarUrl,
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al actualizar avatar" });
  }
});

// ================= CARTAS =================
const palos = ["espada", "basto", "oro", "copa"] as const;
const numeros = ["1", "2", "3", "4", "5", "6", "7", "10", "11", "12"] as const;

const valores: Record<string, number> = {
  "1-espada": 14,
  "1-basto": 13,
  "7-espada": 12,
  "7-oro": 11,
  "3": 10,
  "2": 9,
  "1": 8,
  "12": 7,
  "11": 6,
  "10": 5,
  "7": 4,
  "6": 3,
  "5": 2,
  "4": 1,
};

function crearMazo(): string[] {
  let mazo: string[] = [];
  for (let palo of palos) {
    for (let num of numeros) {
      mazo.push(`${num}-${palo}`);
    }
  }
  return mazo;
}

function getValor(carta: string): number {
  return valores[carta] || valores[carta.split("-")[0]] || 0;
}

function repartir(): [string[], string[]] {
  const mazo = crearMazo().sort(() => Math.random() - 0.5);
  return [mazo.slice(0, 3), mazo.slice(3, 6)];
}

// ================= ENVIDO =================
function valorEnvido(carta: string): number {
  const num = parseInt(carta.split("-")[0]);
  return num >= 10 ? 0 : num;
}

function calcularEnvido(mano: string[]): number {
  let max = 0;

  for (let i = 0; i < mano.length; i++) {
    for (let j = i + 1; j < mano.length; j++) {
      const [_, p1] = mano[i].split("-");
      const [__, p2] = mano[j].split("-");

      if (p1 === p2) {
        max = Math.max(max, 20 + valorEnvido(mano[i]) + valorEnvido(mano[j]));
      }
    }
  }

  for (let c of mano) {
    max = Math.max(max, valorEnvido(c));
  }

  return max;
}

function evaluarFuerzaMano(hand: string[]): number {
  if (!hand || hand.length === 0) return 0;

  const valoresMano = hand.map((c) => {
    const [num] = c.split("-");
    return parseInt(num);
  });

  const max = Math.max(...valoresMano);

  if (max >= 10) return 3; // fuerte
  if (max >= 6) return 2; // media
  return 1; // baja
}

function botAcceptsTruco(hand: string[]): boolean {
  const fuerza = evaluarFuerzaMano(hand);
  const r = Math.random();

  if (fuerza === 3) return true;
  if (fuerza === 2) return r < 0.75;
  return r < 0.45;
}

function handleBotAcceptOrRaiseTruco(g: GameState, gameId: string): boolean {
  const fuerza = evaluarFuerzaMano(g.hands["BOT"] || []);
  const r = Math.random();
  const canRaiseNow = g.truco.level < 4;

  // intenta subir
  if (
    canRaiseNow &&
    ((fuerza === 3 && r < 0.35) || (fuerza === 2 && r < 0.12))
  ) {
    g.truco.level = getNextTrucoLevel(g.truco.level);
    g.truco.pending = true;
    g.truco.caller = "BOT";
    g.truco.acceptedBy = null;
    g.truco.canRaiseBy = null;

    io.to(gameId).emit("updateGame", g);
    return true; // subió → corta flujo
  }

  // acepta normal
  g.truco.pending = false;
  g.truco.acceptedBy = "BOT";
  g.truco.canRaiseBy = "BOT";

  io.to(gameId).emit("updateGame", g);

  // si tiene que jugar, juega
  if (!g.winner && !g.matchWinner && g.turn === "BOT") {
    setTimeout(() => botPlay(gameId), 400);
  }

  return false;
}

function checkMatchWinner(game: GameState): boolean {
  for (const playerId of game.players) {
    if (game.score[playerId] >= 30) {
      game.matchWinner = playerId;
      game.winner = playerId;

      game.envido = {
        calls: [],
        pending: false,
        caller: null,
      };

      game.truco = {
        level: game.truco?.level ?? 1,
        pending: false,
        caller: null,
        acceptedBy: null,
        canRaiseBy: null,
      };

      saveMatchResults(game);

      return true;
    }
  }
  return false;
}

// Asynchronously persist match stats in the database
async function saveMatchResults(game: GameState) {
  const botId = "BOT";
  const players = game.players;
  const humanId = players.find(p => p !== botId);
  if (!humanId) return;

  try {
    const isHumanWinner = game.matchWinner === humanId;
    if (isHumanWinner) {
      await prisma.user.update({
        where: { id: humanId },
        data: {
          wins: { increment: 1 },
          coins: { increment: 100 }
        }
      });
      console.log(`🏆 DB updated: User ${humanId} won.`);
    } else {
      await prisma.user.update({
        where: { id: humanId },
        data: {
          losses: { increment: 1 },
          coins: { decrement: 50 }
        }
      });
      const u = await prisma.user.findUnique({ where: { id: humanId } });
      if (u && u.coins < 0) {
        await prisma.user.update({
          where: { id: humanId },
          data: { coins: 0 }
        });
      }
      console.log(`💀 DB updated: User ${humanId} lost.`);
    }
  } catch (e) {
    console.error("❌ Error persisting match results in DB:", e);
  }
}

function awardTrucoPoints(game: GameState, winner: string) {
  if (!winner) return;

  game.score[winner] += game.truco.level;

  game.lastAction = {
    type: "truco",
    winner,
    points: game.truco.level,
  };

  checkMatchWinner(game);
}

function getNextTrucoLevel(currentLevel: number): number {
  if (currentLevel === 1) return 2; // Truco
  if (currentLevel === 2) return 3; // Retruco
  if (currentLevel === 3) return 4; // Vale 4
  return 4;
}

// ================= ME VOY AL MAZO (FOLD) =================
function handleFold(game: GameState, foldingPlayerId: string) {
  const opponentId = game.players.find((p) => p !== foldingPlayerId) || "BOT";

  // 1. Puntos de envido si no se jugó aún en la primera mano
  let envidoPointsAwarded = 0;
  if (game.history.length === 0 && !game.envidoPlayed) {
    envidoPointsAwarded = 1; // 1 punto por el "no quiero" del envido automático
    game.envidoPlayed = true;
  }

  // 2. Puntos de truco
  let trucoPointsAwarded = 1;
  if (game.truco.pending) {
    // Si hay un canto pendiente, el rival se lleva los puntos de la instancia anterior
    trucoPointsAwarded = game.truco.level - 1;
  } else {
    // Si no hay pendiente, se lleva los puntos del nivel actual
    trucoPointsAwarded = game.truco.level;
  }

  const totalPoints = envidoPointsAwarded + trucoPointsAwarded;
  addScore(game, opponentId, totalPoints);

  game.winner = opponentId;
  game.lastAction = {
    type: "fold",
    winner: opponentId,
    points: totalPoints,
  };

  checkMatchWinner(game);

  // Resetear estados pendientes
  game.envido = null;
  game.truco.pending = false;
}

// ================= CREAR PARTIDA =================
app.post("/game/vs-bot", (req, res) => {
  const { userId } = req.body;

  const gameId = Date.now().toString();
  const botId = "BOT";

  const [p1, p2] = repartir();

  games[gameId] = {
    id: gameId,
    players: [userId, botId],

    turnOrder: [userId, botId],

    hands: { [userId]: [...p1], [botId]: [...p2] },
    initialHands: { [userId]: [...p1], [botId]: [...p2] },

    table: [],
    currentTrick: [],
    history: [],

    turn: userId,
    mano: userId,
    winner: null,
    firstCardPlayed: { [userId]: false, [botId]: false },

    score: { [userId]: 0, [botId]: 0 },
    matchWinner: null,

    envido: {
      calls: [],
      pending: false,
      caller: null,
    },
    envidoPlayed: false,

    truco: {
      level: 1,
      pending: false,
      caller: null,
      acceptedBy: null,
      canRaiseBy: null,
    },

    lastAction: null,
    responseBubble: null,
  };

  res.json(games[gameId]);
});

app.post("/game/next-hand", (req, res) => {
  const { gameId } = req.body;

  const game = games[gameId];
  if (!game) {
    return res.status(404).json({ error: "Game not found" });
  }

  if (game.matchWinner) {
    return res.json(game);
  }

  const [p1, p2] = repartir();

  // alternar mano
  const nextMano =
    game.mano === game.players[0] ? game.players[1] : game.players[0];

  game.hands = {
    [game.players[0]]: [...p1],
    [game.players[1]]: [...p2],
  };

  game.initialHands = {
    [game.players[0]]: [...p1],
    [game.players[1]]: [...p2],
  };

  game.turnOrder = [...game.players];
  if (nextMano === game.players[1]) {
    game.turnOrder = [game.players[1], game.players[0]];
  }

  game.table = [];
  game.currentTrick = [];
  game.history = [];
  game.turn = nextMano;
  game.mano = nextMano;
  game.winner = null;
  game.firstCardPlayed = {
    [game.players[0]]: false,
    [game.players[1]]: false,
  };

  game.envido = {
    calls: [],
    pending: false,
    caller: null,
  };
  game.envidoPlayed = false;

  game.truco = {
    level: 1,
    pending: false,
    caller: null,
    acceptedBy: null,
    canRaiseBy: null,
  };

  game.lastAction = null;
  game.responseBubble = null;

  res.json(game);

  // Si arranca el BOT, que juegue automáticamente
  if (!game.matchWinner && game.turn === "BOT") {
    setTimeout(() => botPlay(gameId), 400);
  }
});

// ================= EVALUAR BAZA =================
function evaluarBaza(game: GameState) {
  if (game.currentTrick.length < 2) return;

  const [c1, c2] = game.currentTrick;

  const v1 = getValor(c1.card);
  const v2 = getValor(c2.card);

  let ganador: string;

  if (v1 > v2) ganador = c1.userId;
  else if (v2 > v1) ganador = c2.userId;
  else ganador = "parda";

  game.history.push(ganador);
  game.currentTrick = [];

  const h = game.history;

  // CASO 1: alguien ganó 2 bazas
  let wins: Record<string, number> = {};
  game.players.forEach((p) => (wins[p] = 0));

  h.forEach((r) => {
    if (r !== "parda") wins[r]++;
  });

  for (let p of game.players) {
    if (wins[p] === 2) {
      game.winner = p;
      awardTrucoPoints(game, p);
      return;
    }
  }

  // CASO 2: 2 bazas jugadas
  if (h.length === 2) {
    const [r1, r2] = h;

    // ganó primera y empataron segunda
    if (r2 === "parda" && r1 !== "parda") {
      game.winner = r1;
    }
    // primera parda, segunda define
    else if (r1 === "parda" && r2 !== "parda") {
      game.winner = r2;
    }

    if (game.winner) {
      awardTrucoPoints(game, game.winner);
      return;
    }
  }

  // CASO 3: 3 bazas
  if (h.length === 3) {
    const [r1, r2, r3] = h;

    if (r3 === "parda") {
      if (r1 !== "parda") game.winner = r1;
      else if (r2 !== "parda") game.winner = r2;
      else game.winner = game.mano;
    } else {
      game.winner = r3;
    }

    awardTrucoPoints(game, game.winner);
    return;
  }

  // turno siguiente
  game.turn = ganador === "parda" ? c1.userId : ganador;
}

// ================= SOCKETS =================
// ================= SOCKETS AUTHENTICATION HANDSHAKE =================
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string };
    socket.data.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", (socket: Socket) => {
  socket.on("joinGame", ({ gameId }) => {
    socket.join(gameId);
  });

  // Evento "Me voy al mazo"
  socket.on("fold", ({ gameId, userId }) => {
    const game = games[gameId];
    if (!game || game.winner || game.matchWinner) return;

    const isUserTurn = game.turn === userId;
    const isUserRespondingEnvido = game.envido?.pending && game.envido.caller !== userId;
    const isUserRespondingTruco = game.truco?.pending && game.truco.caller !== userId;

    if (!isUserTurn && !isUserRespondingEnvido && !isUserRespondingTruco) return;

    handleFold(game, userId);
    io.to(gameId).emit("updateGame", game);
  });

  socket.on("playCard", ({ gameId, userId, card }) => {
    const game = games[gameId];
    if (!game || game.winner || game.matchWinner || game.envido?.pending)
      return;
    if (game.turn !== userId) return;

    if (!game.hands[userId].includes(card)) return;

    game.hands[userId] = game.hands[userId].filter((c) => c !== card);

    if (!game.firstCardPlayed[userId]) {
      game.firstCardPlayed[userId] = true;
    }

    game.table.push({ userId, card });
    game.currentTrick.push({ userId, card });

    if (game.currentTrick.length === 1) {
      game.turn = game.players.find((p) => p !== userId) || "BOT";
    } else {
      evaluarBaza(game);
    }

    io.to(gameId).emit("updateGame", game);

    if (!game.winner && game.turn === "BOT") {
      setTimeout(() => botPlay(gameId), 400);
    }
  });

  // ===== ENVIDO =====
  socket.on("callEnvido", ({ gameId, userId, type }) => {
    const game = games[gameId];
    if (!game || game.matchWinner) return;
    if (game.envidoPlayed && !game.envido?.pending) return;

    const envidoCount =
      game.envido?.calls?.filter((c) => c === "envido").length || 0;
    const hasReal = game.envido?.calls?.includes("real") || false;
    const hasFalta = game.envido?.calls?.includes("falta") || false;

    const isManoTurn = game.turn === userId && game.table.length === 0;
    const isPieReplyWindow =
      game.turn === userId &&
      game.table.length === 1 &&
      !game.firstCardPlayed[userId];

    const canReplyToPendingTrucoWithEnvido =
      game.truco?.pending &&
      game.truco.caller !== userId &&
      !game.firstCardPlayed[userId];

    const trucoYaAceptado = game.truco.level > 1 && !game.truco.pending;
    if (trucoYaAceptado) return;

    if (!game.envido?.pending) {
      if (!isManoTurn && !isPieReplyWindow && !canReplyToPendingTrucoWithEnvido)
        return;

      game.envido = {
        calls: [type],
        pending: true,
        caller: userId,
      };
      game.envidoPlayed = true;

      console.log("🟡 ENVIDO:", game.envido.calls.join(" -> "));
      io.to(gameId).emit("updateGame", game);

      if (userId !== "BOT") {
        setTimeout(() => {
          responderEnvidoBot(gameId);
        }, 600);
      }

      return;
    }

    if (game.envido.caller === userId) return;

    if (type === "envido") {
      if (envidoCount >= 2 || hasReal || hasFalta) return;
    }
    if (type === "real") {
      if (hasReal || hasFalta) return;
    }
    if (type === "falta") {
      if (hasFalta) return;
    }

    game.envido.calls.push(type);
    game.envido.caller = userId;
    game.envido.pending = true;
    game.envidoPlayed = true;

    console.log("🟡 ENVIDO:", game.envido.calls.join(" -> "));
    io.to(gameId).emit("updateGame", game);

    if (userId !== "BOT") {
      setTimeout(() => {
        responderEnvidoBot(gameId);
      }, 600);
    }
  });

  socket.on("respondEnvido", ({ gameId, userId, accept }) => {
    const game = games[gameId];
    if (!game || game.matchWinner || !game.envido?.pending) return;
    if (game.envido.caller === userId) return;
    showResponseBubble(gameId, userId, accept ? "Quiero" : "No Quiero");

    const caller = game.envido.caller || "BOT";

    if (!accept) {
      const puntos = calcularNoQuiero(game.envido.calls);

      addScore(game, caller, puntos);
      checkMatchWinner(game);

      game.lastAction = {
        type: "envido",
        accepted: false,
        winner: caller,
        points: puntos,
        envidoPoints: {},
        winnerPoints: null,
        envidoSteps: [],
        resolutionId: Date.now(),
      };

      game.envido = null;

      io.to(gameId).emit("updateGame", game);

      if (
        !game.winner &&
        !game.matchWinner &&
        game.turn === "BOT" &&
        !game.truco?.pending
      ) {
        setTimeout(() => botPlay(gameId), 400);
      }
      return;
    }

    resolverEnvidoCompleto(game);
    io.to(gameId).emit("updateGame", game);

    if (
      !game.winner &&
      !game.matchWinner &&
      game.turn === "BOT" &&
      !game.truco?.pending
    ) {
      setTimeout(() => botPlay(gameId), 400);
    }
  });

  // ===== TRUCO =====
  socket.on("callTruco", ({ gameId, userId }) => {
    const game = games[gameId];
    if (!game || game.envido?.pending) return;
    if (game.winner || game.matchWinner) return;
    if (game.truco.level >= 4) return;

    if (!game.truco.pending && game.turn !== userId) return;

    if (game.truco.pending) {
      if (game.truco.caller === userId) return;

      const nextLevel = getNextTrucoLevel(game.truco.level);
      if (nextLevel === game.truco.level) return;

      game.truco.level = nextLevel;
      game.truco.pending = true;
      game.truco.caller = userId;
      game.truco.acceptedBy = null;
      game.truco.canRaiseBy = null;

      io.to(gameId).emit("updateGame", game);

      if (userId !== "BOT") {
        setTimeout(() => {
          const g = games[gameId];
          if (!g || !g.truco.pending) return;

          const botAccepts = botAcceptsTruco(g.hands["BOT"] || []);

          if (!botAccepts) {
            showResponseBubble(gameId, "BOT", "No Quiero");
            const winner = g.truco.caller || userId;
            const puntos = g.truco.level - 1;

            g.winner = winner;
            addScore(g, winner, puntos);

            g.lastAction = {
              type: "truco",
              winner,
              points: puntos,
            };

            checkMatchWinner(g);
            g.truco.pending = false;

            io.to(gameId).emit("updateGame", g);
            return;
          }

          showResponseBubble(gameId, "BOT", "Quiero");
          const raised = handleBotAcceptOrRaiseTruco(g, gameId);
          if (raised) return;
        }, 500);
      }

      return;
    }

    if (game.truco.level === 1) {
      game.truco.level = 2;
      game.truco.pending = true;
      game.truco.caller = userId;
      game.truco.acceptedBy = null;
      game.truco.canRaiseBy = null;

      io.to(gameId).emit("updateGame", game);

      if (userId !== "BOT") {
        setTimeout(() => {
          const g = games[gameId];
          if (!g || !g.truco.pending) return;

          const botAccepts = botAcceptsTruco(g.hands["BOT"] || []);

          if (!botAccepts) {
            showResponseBubble(gameId, "BOT", "No Quiero");
            const winner = g.truco.caller || userId;
            const puntos = g.truco.level - 1;

            g.winner = winner;
            addScore(g, winner, puntos);

            g.lastAction = {
              type: "truco",
              winner,
              points: puntos,
            };

            checkMatchWinner(g);
            g.truco.pending = false;

            io.to(gameId).emit("updateGame", g);
            return;
          }

          showResponseBubble(gameId, "BOT", "Quiero");
          const raised = handleBotAcceptOrRaiseTruco(g, gameId);
          if (raised) return;

          if (!g.winner && g.turn === "BOT") {
            setTimeout(() => botPlay(gameId), 400);
          }
        }, 500);
      }

      return;
    }

    if (game.truco.canRaiseBy !== userId) return;

    const nextLevel = getNextTrucoLevel(game.truco.level);
    if (nextLevel === game.truco.level) return;

    game.truco.level = nextLevel;
    game.truco.pending = true;
    game.truco.caller = userId;
    game.truco.acceptedBy = null;
    game.truco.canRaiseBy = null;

    io.to(gameId).emit("updateGame", game);

    if (userId !== "BOT") {
      setTimeout(() => {
        const g = games[gameId];
        if (!g || !g.truco.pending) return;

        const botAccepts = botAcceptsTruco(g.hands["BOT"] || []);

        if (!botAccepts) {
          showResponseBubble(gameId, "BOT", "No Quiero");
          const winner = g.truco.caller || userId;
          const puntos = g.truco.level - 1;

          g.winner = winner;
          addScore(g, winner, puntos);

          g.lastAction = {
            type: "truco",
            winner,
            points: puntos,
          };

          checkMatchWinner(g);
          g.truco.pending = false;

          io.to(gameId).emit("updateGame", g);
          return;
        }

        showResponseBubble(gameId, "BOT", "Quiero");
        const raised = handleBotAcceptOrRaiseTruco(g, gameId);
        if (raised) return;
      }, 500);
    }
  });

  socket.on("respondTruco", ({ gameId, userId, accept }) => {
    const game = games[gameId];
    if (!game || game.matchWinner || !game.truco.pending) return;
    if (game.truco.caller === userId) return;
    showResponseBubble(gameId, userId, accept ? "Quiero" : "No Quiero");

    if (!accept) {
      const winner = game.truco.caller || "BOT";
      const puntos = game.truco.level - 1;

      game.winner = winner;
      addScore(game, winner, puntos);

      game.lastAction = {
        type: "truco",
        winner,
        points: puntos,
      };

      checkMatchWinner(game);
      game.truco.pending = false;

      io.to(gameId).emit("updateGame", game);
      return;
    }

    game.truco.pending = false;
    game.truco.acceptedBy = userId;
    game.truco.canRaiseBy = userId;

    io.to(gameId).emit("updateGame", game);

    if (!game.winner && !game.matchWinner && game.turn === "BOT") {
      setTimeout(() => botPlay(gameId), 400);
    }
  });
});

// ================= BOT PLAY IA =================
function botPlay(gameId: string) {
  const game = games[gameId];
  if (!game || game.winner || game.matchWinner || game.envido?.pending) return;
  if (game.turn !== "BOT") return;

  if (!game.truco?.pending) {
    maybeBotCallEnvido(gameId);

    const refreshedGame = games[gameId];
    if (refreshedGame?.envido?.pending) {
      return;
    }
  }

  const hand = game.hands["BOT"] || [];
  hand.sort((a, b) => getValor(b) - getValor(a));

  // Decidir si canta truco antes de jugar
  if (!game.truco.pending && game.truco.level === 1 && !game.envido?.pending) {
    const fuerza = evaluarFuerzaMano(game.hands["BOT"] || []);
    const r = Math.random();

    if ((fuerza === 3 && r < 0.5) || (fuerza === 2 && r < 0.2)) {
      game.truco.level = 2;
      game.truco.pending = true;
      game.truco.caller = "BOT";

      io.to(gameId).emit("updateGame", game);
      return;
    }
  }

  const card = hand.shift();
  if (!card) return;

  game.hands["BOT"] = hand;

  if (!game.firstCardPlayed["BOT"]) {
    game.firstCardPlayed["BOT"] = true;
  }

  game.table.push({ userId: "BOT", card });
  game.currentTrick.push({ userId: "BOT", card });

  if (game.currentTrick.length === 1) {
    game.turn = game.players[0];
  } else {
    evaluarBaza(game);
  }

  io.to(gameId).emit("updateGame", game);

  if (!game.winner && game.turn === "BOT") {
    setTimeout(() => botPlay(gameId), 400);
  }
}

function addScore(game: GameState, playerId: string, points: number) {
  const newScore = (game.score[playerId] || 0) + points;
  game.score[playerId] = Math.min(newScore, 30);
}

function showResponseBubble(gameId: string, playerId: string, text: string) {
  const game = games[gameId];
  if (!game) return;

  game.responseBubble = {
    playerId,
    text,
    id: Date.now(),
  };

  io.to(gameId).emit("updateGame", game);

  setTimeout(() => {
    const g = games[gameId];
    if (!g || !g.responseBubble) return;

    if (
      g.responseBubble.playerId === playerId &&
      g.responseBubble.text === text
    ) {
      g.responseBubble = null;
      io.to(gameId).emit("updateGame", g);
    }
  }, 1500);
}

function responderEnvidoBot(gameId: string) {
  const game = games[gameId];
  if (!game || !game.envido?.pending) return;

  const decision = getBotEnvidoDecision(game);

  if (decision.action === "reject") {
    showResponseBubble(gameId, "BOT", "No Quiero");
    const puntos = calcularNoQuiero(game.envido.calls);

    addScore(game, game.envido.caller || "BOT", puntos);
    checkMatchWinner(game);

    game.lastAction = {
      type: "envido",
      accepted: false,
      winner: game.envido.caller || "BOT",
      points: puntos,
      envidoPoints: {},
      winnerPoints: null,
      envidoSteps: [],
      resolutionId: Date.now(),
    };

    game.envido = null;
    io.to(gameId).emit("updateGame", game);
    return;
  }

  if (decision.action === "raise" && decision.raiseType) {
    game.envido.calls.push(decision.raiseType);
    game.envido.caller = "BOT";
    game.envido.pending = true;

    io.to(gameId).emit("updateGame", game);
    return;
  }

  showResponseBubble(gameId, "BOT", "Quiero");
  resolverEnvidoCompleto(game);
  io.to(gameId).emit("updateGame", game);
}

function resolverEnvidoCompleto(game: GameState) {
  const resultado = resolverGanadorEnvido(game);
  const winner = resultado.winner;
  const envidoPoints = resultado.puntos;

  const canto = buildEnvidoCanto(game, envidoPoints);

  const puntos = calcularPuntosEnvido(game.envido!.calls, game, winner);

  addScore(game, winner, puntos);
  checkMatchWinner(game);

  game.lastAction = {
    type: "envido",
    accepted: true,
    winner,
    winnerPoints: canto.winnerPoints,
    points: puntos,
    envidoPoints,
    envidoSpoken: canto.spoken,
    envidoSteps: canto.steps,
    resolutionId: Date.now(),
  };

  console.log("====== ENVIDO FINAL ======");
  console.log("Cadena:", game.envido!.calls.join(" -> "));
  console.log("Puntos:", envidoPoints);
  console.log("Ganador:", winner, "+", puntos);
  console.log("Cantados:", canto.spoken);
  console.log("==========================");

  game.envido = null;

  if (
    !game.winner &&
    !game.matchWinner &&
    game.turn === "BOT" &&
    !game.truco?.pending
  ) {
    setTimeout(() => botPlay(game.id), 400);
  }
}

function calcularPuntosEnvido(calls: string[], game: GameState, winner: string): number {
  let puntos = 0;

  for (let c of calls) {
    if (c === "envido") puntos += 2;
    if (c === "real") puntos += 3;

    if (c === "falta") {
      const loser = game.players.find((p) => p !== winner) || "BOT";
      return 30 - game.score[loser];
    }
  }

  return puntos;
}

function calcularNoQuiero(calls: string[]): number {
  if (calls.length === 1) return 1;

  let puntos = 0;

  for (let i = 0; i < calls.length - 1; i++) {
    if (calls[i] === "envido") puntos += 2;
    if (calls[i] === "real") puntos += 3;
  }

  return puntos;
}

function getTeamIndex(game: GameState, playerId: string): number {
  const index = game.players.indexOf(playerId);
  return index % 2;
}

function buildEnvidoCanto(game: GameState, envidoPoints: Record<string, number>) {
  const order =
    game.turnOrder && game.turnOrder.length ? game.turnOrder : game.players;

  let currentWinner: string | null = null;
  let currentWinningPoints = -1;
  let currentWinningTeam: number | null = null;

  const spoken: Record<string, string | number> = {};
  const steps: EnvidoStep[] = [];

  for (const playerId of order) {
    const points = envidoPoints[playerId] ?? 0;
    const teamIndex = getTeamIndex(game, playerId);

    if (currentWinner === null) {
      currentWinner = playerId;
      currentWinningPoints = points;
      currentWinningTeam = teamIndex;

      spoken[playerId] = points;
      steps.push({
        playerId,
        type: "points",
        value: points,
      });
      continue;
    }

    if (teamIndex !== currentWinningTeam && points > currentWinningPoints) {
      currentWinner = playerId;
      currentWinningPoints = points;
      currentWinningTeam = teamIndex;

      spoken[playerId] = points;
      steps.push({
        playerId,
        type: "points",
        value: points,
      });
    } else {
      spoken[playerId] = "Son buenas";
      steps.push({
        playerId,
        type: "good",
        value: "Son buenas",
      });
    }
  }

  return {
    winner: currentWinner || order[0],
    winnerPoints: currentWinningPoints,
    spoken,
    steps,
  };
}

function resolverGanadorEnvido(game: GameState) {
  const players = game.players;

  const teamA = players.filter((_, i) => i % 2 === 0);
  const teamB = players.filter((_, i) => i % 2 !== 0);

  const puntos: Record<string, number> = {};
  players.forEach((p) => {
    puntos[p] = calcularEnvido(game.initialHands[p] || []);
  });

  const mejorA = Math.max(...teamA.map((p) => puntos[p] ?? 0));
  const mejorB = Math.max(...teamB.map((p) => puntos[p] ?? 0));

  if (mejorA > mejorB) {
    return { winner: teamA[0], puntos };
  }
  if (mejorB > mejorA) {
    return { winner: teamB[0], puntos };
  }

  const candidatos = players.filter((p) => puntos[p] === mejorA);
  const order =
    game.turnOrder && game.turnOrder.length ? game.turnOrder : players;

  for (let p of order) {
    if (candidatos.includes(p)) {
      return { winner: p, puntos };
    }
  }

  return { winner: order[0], puntos };
}

function evaluarFuerzaEnvido(points: number): number {
  if (points >= 30) return 4; // excelente
  if (points >= 27) return 3; // fuerte
  if (points >= 24) return 2; // media
  return 1; // floja
}

function getBotEnvidoDecision(game: GameState): { action: string; raiseType?: string } {
  const botPoints = calcularEnvido(game.initialHands["BOT"] || []);
  const fuerza = evaluarFuerzaEnvido(botPoints);

  const calls = game.envido?.calls || [];
  const envidoCount = calls.filter((c) => c === "envido").length;
  const hasReal = calls.includes("real");
  const hasFalta = calls.includes("falta");

  const r = Math.random();
  const opciones: string[] = [];

  if (envidoCount < 2 && !hasReal && !hasFalta) {
    opciones.push("envido");
  }
  if (!hasReal && !hasFalta) {
    opciones.push("real");
  }
  if (!hasFalta) {
    opciones.push("falta");
  }

  if (fuerza === 4) {
    if (opciones.length && r < 0.6) {
      const raiseType = opciones.includes("real")
        ? "real"
        : opciones.includes("falta")
          ? "falta"
          : opciones[0];
      return { action: "raise", raiseType };
    }
    return { action: "accept" };
  }

  if (fuerza === 3) {
    if (opciones.length && r < 0.35) {
      const raiseType = opciones.includes("real") ? "real" : opciones[0];
      return { action: "raise", raiseType };
    }
    if (r < 0.9) return { action: "accept" };
    return { action: "reject" };
  }

  if (fuerza === 2) {
    if (opciones.length && r < 0.15) {
      return { action: "raise", raiseType: opciones[0] };
    }
    if (r < 0.65) return { action: "accept" };
    return { action: "reject" };
  }

  if (opciones.length && r < 0.05) {
    return { action: "raise", raiseType: opciones[0] };
  }
  if (r < 0.35) return { action: "accept" };
  return { action: "reject" };
}

function maybeBotCallEnvido(gameId: string) {
  const game = games[gameId];
  if (!game || game.winner || game.matchWinner) return;
  if (game.envido?.pending || game.envidoPlayed) return;

  if (game.firstCardPlayed?.["BOT"]) return;

  // BUG FIX: Si el truco ya se cantó/aceptó (level > 1), no se puede iniciar envido de la nada
  if (game.truco && game.truco.level > 1) return;

  const botPoints = calcularEnvido(game.initialHands["BOT"] || []);
  const fuerza = evaluarFuerzaEnvido(botPoints);
  const r = Math.random();

  let initialCall: string | null = null;

  if (fuerza === 4) {
    if (r < 0.2) initialCall = "falta";
    else if (r < 0.65) initialCall = "real";
    else if (r < 0.9) initialCall = "envido";
  } else if (fuerza === 3) {
    if (r < 0.15) initialCall = "real";
    else if (r < 0.5) initialCall = "envido";
  } else if (fuerza === 2) {
    if (r < 0.15) initialCall = "envido";
  }

  if (!initialCall) return;

  game.envido = {
    calls: [initialCall],
    pending: true,
    caller: "BOT",
  };
  game.envidoPlayed = true;

  io.to(gameId).emit("updateGame", game);
}

server.listen(3000, () => console.log("Server running on port 3000"));
