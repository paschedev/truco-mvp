import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const games = {};
const users = [];

// ================= LOGIN =================
app.post("/auth/login", (req, res) => {
  const { username } = req.body;

  let user = users.find((u) => u.username === username);

  if (!user) {
    user = { id: Date.now().toString(), username };
    users.push(user);
  }

  res.json({ user });
});

// ================= CARTAS =================
const palos = ["espada", "basto", "oro", "copa"];
const numeros = ["1", "2", "3", "4", "5", "6", "7", "10", "11", "12"];

const valores = {
  "1-espada": 14,
  "1-basto": 13,
  "7-espada": 12,
  "7-oro": 11,
  3: 10,
  2: 9,
  1: 8,
  12: 7,
  11: 6,
  10: 5,
  7: 4,
  6: 3,
  5: 2,
  4: 1,
};

function crearMazo() {
  let mazo = [];
  for (let palo of palos) {
    for (let num of numeros) {
      mazo.push(`${num}-${palo}`);
    }
  }
  return mazo;
}

function getValor(carta) {
  return valores[carta] || valores[carta.split("-")[0]];
}

function repartir() {
  const mazo = crearMazo().sort(() => Math.random() - 0.5);
  return [mazo.slice(0, 3), mazo.slice(3, 6)];
}

// ================= ENVIDO =================
function valorEnvido(carta) {
  const num = parseInt(carta.split("-")[0]);
  return num >= 10 ? 0 : num;
}

function calcularEnvido(mano) {
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

function evaluarFuerzaMano(hand) {
  if (!hand || hand.length === 0) return 0;

  // ranking simple basado en valor
  const valores = hand.map((c) => {
    const [num] = c.split("-");
    return parseInt(num);
  });

  const max = Math.max(...valores);

  // aproximación simple
  if (max >= 10) return 3; // fuerte
  if (max >= 6) return 2; // media
  return 1; // baja
}

function botAcceptsTruco(hand) {
  const fuerza = evaluarFuerzaMano(hand);
  const r = Math.random();

  if (fuerza === 3) return true;
  if (fuerza === 2) return r < 0.75;
  return r < 0.45;
}

function handleBotAcceptOrRaiseTruco(g, gameId) {
  const fuerza = evaluarFuerzaMano(g.hands["BOT"]);
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

function checkMatchWinner(game) {
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

      return true;
    }
  }
  return false;
}

function awardTrucoPoints(game, winner) {
  if (!winner) return;

  game.score[winner] += game.truco.level;

  game.lastAction = {
    type: "truco",
    winner,
    points: game.truco.level,
  };

  checkMatchWinner(game);
}

function getNextTrucoLevel(currentLevel) {
  if (currentLevel === 1) return 2; // Truco
  if (currentLevel === 2) return 3; // Retruco
  if (currentLevel === 3) return 4; // Vale 4
  return 4;
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

  // alternar mano para testing más realista
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
function evaluarBaza(game) {
  if (game.currentTrick.length < 2) return;

  const [c1, c2] = game.currentTrick;

  const v1 = getValor(c1.card);
  const v2 = getValor(c2.card);

  let ganador;

  if (v1 > v2) ganador = c1.userId;
  else if (v2 > v1) ganador = c2.userId;
  else ganador = "parda";

  game.history.push(ganador);
  game.currentTrick = [];

  const h = game.history;

  // 🧠 CASO 1: alguien ganó 2
  let wins = {};
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

  // 🧠 CASO 2: 2 bazas jugadas
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

  // 🧠 CASO 3: 3 bazas
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
io.on("connection", (socket) => {
  socket.on("joinGame", ({ gameId }) => {
    socket.join(gameId);
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
      game.turn = game.players.find((p) => p !== userId);
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

    // Si no hay envido pendiente, validamos apertura normal
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

    // Si YA hay envido pendiente, solo puede subir el que está respondiendo
    if (game.envido.caller === userId) return;

    // Validaciones de cadena
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

    if (!accept) {
      const puntos = calcularNoQuiero(game.envido.calls);

      addScore(game, game.envido.caller, puntos);
      checkMatchWinner(game);

      game.lastAction = {
        type: "envido",
        accepted: false,
        winner: game.envido.caller,
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

      // si el humano sube, el bot responde
      if (userId !== "BOT") {
        setTimeout(() => {
          const g = games[gameId];
          if (!g || !g.truco.pending) return;

          const botAccepts = botAcceptsTruco(g.hands["BOT"]);

          if (!botAccepts) {
            showResponseBubble(gameId, "BOT", "No Quiero");
            const winner = g.truco.caller;
            const puntos = g.truco.level - 1;

            g.winner = winner;
            addScore(game, winner, puntos);

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

    // CASO 2: todavía no hay truco
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

          const botAccepts = botAcceptsTruco(g.hands["BOT"]);

          if (!botAccepts) {
            showResponseBubble(gameId, "BOT", "No Quiero");
            const winner = g.truco.caller;
            const puntos = g.truco.level - 1;

            g.winner = winner;
            addScore(game, winner, puntos);

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

          // si el BOT había cantado en su turno, tras aceptar debe jugar
          if (!g.winner && g.turn === "BOT") {
            setTimeout(() => botPlay(gameId), 400);
          }
        }, 500);
      }

      return;
    }

    // CASO 3: ya fue aceptado antes y suben más tarde
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

        const botAccepts = botAcceptsTruco(g.hands["BOT"]);

        if (!botAccepts) {
          showResponseBubble(gameId, "BOT", "No Quiero");
          const winner = g.truco.caller;
          const puntos = g.truco.level - 1;

          g.winner = winner;
          addScore(game, winner, puntos);

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
      const winner = game.truco.caller;
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

// ================= BOT =================
function botPlay(gameId) {
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

  const hand = game.hands["BOT"];
  hand.sort((a, b) => getValor(b) - getValor(a));

  // IA: decidir si canta truco antes de jugar
  if (!game.truco.pending && game.truco.level === 1 && !game.envido?.pending) {
    const fuerza = evaluarFuerzaMano(game.hands["BOT"]);
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

function addScore(game, playerId, points) {
  const newScore = (game.score[playerId] || 0) + points;
  game.score[playerId] = Math.min(newScore, 30);
}

function showResponseBubble(gameId, playerId, text) {
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

function responderEnvidoBot(gameId) {
  const game = games[gameId];
  if (!game || !game.envido?.pending) return;

  const decision = getBotEnvidoDecision(game);

  if (decision.action === "reject") {
    showResponseBubble(gameId, "BOT", "No Quiero");
    const puntos = calcularNoQuiero(game.envido.calls);

    addScore(game, game.envido.caller, puntos);
    checkMatchWinner(game);

    game.lastAction = {
      type: "envido",
      winner: game.envido.caller,
      points: puntos,
      envidoPoints: {},
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

function resolverEnvidoCompleto(game) {
  const resultado = resolverGanadorEnvido(game);
  const winner = resultado.winner;
  const envidoPoints = resultado.puntos;

  const canto = buildEnvidoCanto(game, envidoPoints);

  const puntos = calcularPuntosEnvido(game.envido.calls, game, winner);

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
  console.log("Cadena:", game.envido.calls.join(" -> "));
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

function calcularPuntosEnvido(calls, game, winner) {
  let puntos = 0;

  for (let c of calls) {
    if (c === "envido") puntos += 2;
    if (c === "real") puntos += 3;

    if (c === "falta") {
      const loser = game.players.find((p) => p !== winner);
      return 30 - game.score[loser];
    }
  }

  return puntos;
}

function calcularNoQuiero(calls) {
  if (calls.length === 1) return 1;

  let puntos = 0;

  for (let i = 0; i < calls.length - 1; i++) {
    if (calls[i] === "envido") puntos += 2;
    if (calls[i] === "real") puntos += 3;
  }

  return puntos;
}

function getTeamIndex(game, playerId) {
  const index = game.players.indexOf(playerId);
  return index % 2;
}

function buildEnvidoCanto(game, envidoPoints) {
  const order =
    game.turnOrder && game.turnOrder.length ? game.turnOrder : game.players;

  let currentWinner = null;
  let currentWinningPoints = -1;
  let currentWinningTeam = null;

  const spoken = {};
  const steps = [];

  for (const playerId of order) {
    const points = envidoPoints[playerId];
    const teamIndex = getTeamIndex(game, playerId);

    // el primero siempre canta
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

    // solo canta puntos si puede matar al que va ganando Y es del equipo rival
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
    winner: currentWinner,
    winnerPoints: currentWinningPoints,
    spoken,
    steps,
  };
}

function resolverGanadorEnvido(game) {
  const players = game.players;

  // equipos alternados
  const teamA = players.filter((_, i) => i % 2 === 0);
  const teamB = players.filter((_, i) => i % 2 !== 0);

  const puntos = {};
  players.forEach((p) => {
    puntos[p] = calcularEnvido(game.initialHands[p]);
  });

  const mejorA = Math.max(...teamA.map((p) => puntos[p]));
  const mejorB = Math.max(...teamB.map((p) => puntos[p]));

  // ganador directo por equipo
  if (mejorA > mejorB) {
    return { winner: teamA[0], puntos };
  }
  if (mejorB > mejorA) {
    return { winner: teamB[0], puntos };
  }

  // empate → desempate por orden relativo
  const candidatos = players.filter((p) => puntos[p] === mejorA);

  const order =
    game.turnOrder && game.turnOrder.length ? game.turnOrder : players; // fallback seguro

  for (let p of order) {
    if (candidatos.includes(p)) {
      return { winner: p, puntos };
    }
  }
}

function evaluarFuerzaEnvido(points) {
  if (points >= 30) return 4; // excelente
  if (points >= 27) return 3; // fuerte
  if (points >= 24) return 2; // media
  return 1; // floja
}

function getBotEnvidoDecision(game) {
  const botPoints = calcularEnvido(game.initialHands["BOT"] || []);
  const fuerza = evaluarFuerzaEnvido(botPoints);

  const calls = game.envido?.calls || [];
  const envidoCount = calls.filter((c) => c === "envido").length;
  const hasReal = calls.includes("real");
  const hasFalta = calls.includes("falta");

  const r = Math.random();

  // qué podría subir legalmente
  const opciones = [];

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

  // mano floja
  if (opciones.length && r < 0.05) {
    return { action: "raise", raiseType: opciones[0] };
  }
  if (r < 0.35) return { action: "accept" };
  return { action: "reject" };
}

function maybeBotCallEnvido(gameId) {
  const game = games[gameId];
  if (!game || game.winner || game.matchWinner) return;
  if (game.envido?.pending || game.envidoPlayed) return;

  // solo antes de jugar su primera carta
  if (game.firstCardPlayed?.["BOT"]) return;

  const botPoints = calcularEnvido(game.initialHands["BOT"] || []);
  const fuerza = evaluarFuerzaEnvido(botPoints);
  const r = Math.random();

  let initialCall = null;

  if (fuerza === 4) {
    if (r < 0.2) initialCall = "falta";
    else if (r < 0.65) initialCall = "real";
    else if (r < 0.9) initialCall = "envido";
  } else if (fuerza === 3) {
    if (r < 0.15) initialCall = "real";
    else if (r < 0.5) initialCall = "envido";
  } else if (fuerza === 2) {
    if (r < 0.15) initialCall = "envido";
  } else {
    initialCall = null;
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

server.listen(3000, () => console.log("Server running"));
