import { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import "./App.css";
import matchImg from "./assets/match.svg";
import { getCartaImg } from "./utils/cartas";

const socket = io("http://localhost:3000");

function MatchScore({ score, label }) {
  const cappedScore = Math.min(score, 30);

  const isBuenas = cappedScore >= 15;
  const cycleScore = isBuenas ? cappedScore - 15 : cappedScore;

  const renderBox = (pointsInBox, boxIndex) => {
    const active = Math.max(0, Math.min(pointsInBox, 5));

    return (
      <div key={boxIndex} className="match-box">
        <img
          src={matchImg}
          alt=""
          className={`match-stick top ${active >= 1 ? "active" : "inactive"}`}
        />
        <img
          src={matchImg}
          alt=""
          className={`match-stick right ${active >= 2 ? "active" : "inactive"}`}
        />
        <img
          src={matchImg}
          alt=""
          className={`match-stick bottom ${active >= 3 ? "active" : "inactive"}`}
        />
        <img
          src={matchImg}
          alt=""
          className={`match-stick left ${active >= 4 ? "active" : "inactive"}`}
        />
        <img
          src={matchImg}
          alt=""
          className={`match-stick diagonal ${active >= 5 ? "active" : "inactive"}`}
        />
      </div>
    );
  };

  const boxes = [];

  for (let i = 0; i < 3; i++) {
    const boxScore = Math.max(0, Math.min(5, cycleScore - i * 5));
    boxes.push(renderBox(boxScore, i));
  }

  return (
    <div className="score-track">
      <div className="score-label">{label}</div>

      <div
        className={`score-cycle ${isBuenas ? "buenas-cycle" : "malas-cycle"}`}
      >
        <div className="score-boxes">{boxes}</div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [game, setGame] = useState(null);
  const [envidoLocked, setEnvidoLocked] = useState(false);
  const [revealedEnvidoSteps, setRevealedEnvidoSteps] = useState(0);
  const [leavingCard, setLeavingCard] = useState(null);
  const [activeBubbles, setActiveBubbles] = useState({});
  const bubbleQueuesRef = useRef({});
  const bubbleTimersRef = useRef({});
  const bubbleSeenRef = useRef({});
  const handSignature = game?.initialHands
    ? JSON.stringify(game.initialHands)
    : "";

  useEffect(() => {
    socket.on("updateGame", (g) => {
      setGame({ ...g });
    });
  }, []);

  useEffect(() => {
    if (
      !game?.lastAction ||
      game.lastAction.type !== "envido" ||
      !game.lastAction.envidoSteps?.length
    ) {
      setRevealedEnvidoSteps(0);
      return;
    }

    setRevealedEnvidoSteps(0);

    let index = 0;
    let hideTimeout;

    const interval = setInterval(() => {
      index += 1;
      setRevealedEnvidoSteps(index);

      if (index >= game.lastAction.envidoSteps.length) {
        clearInterval(interval);

        hideTimeout = setTimeout(() => {
          setRevealedEnvidoSteps(0);
        }, 2500);
      }
    }, 700);

    return () => {
      clearInterval(interval);
      if (hideTimeout) clearTimeout(hideTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.lastAction?.resolutionId]);

  const login = async () => {
    const res = await fetch("http://localhost:3000/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test" }),
    });

    const data = await res.json();
    setUser(data.user);
  };

  const playVsBot = async () => {
    const res = await fetch("http://localhost:3000/game/vs-bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    const g = await res.json();

    setGame(g);
    setEnvidoLocked(false);
    socket.emit("joinGame", { gameId: g.id });
  };

  const playCard = (card) => {
    if (leavingCard) return;

    setLeavingCard(card);

    setTimeout(() => {
      socket.emit("playCard", {
        gameId: game.id,
        userId: user.id,
        card,
      });

      setLeavingCard(null);
    }, 180);
  };

  const nextHand = async () => {
    const res = await fetch("http://localhost:3000/game/next-hand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: game.id }),
    });

    const g = await res.json();

    setGame(g);
    setEnvidoLocked(false);
    socket.emit("joinGame", { gameId: g.id });
  };

  const newMatch = async () => {
    await playVsBot();
  };

  const getTrucoLabel = () => {
    if (!game?.truco) return "Truco";
    if (game.truco.level === 1) return "Truco";
    if (game.truco.level === 2) return "Retruco";
    if (game.truco.level === 3) return "Vale 4";
    return "Vale 4";
  };

  const getTrucoStatus = () => {
    if (!game?.truco) return "Sin Truco";
    if (game.truco.level === 1) return "Sin Truco";
    if (game.truco.level === 2) return "Truco";
    if (game.truco.level === 3) return "Retruco";
    if (game.truco.level === 4) return "Vale 4";
    return "Sin Truco";
  };

  const getPendingTrucoLabel = () => {
    if (!game?.truco) return "Truco";
    if (game.truco.level === 2) return "Truco";
    if (game.truco.level === 3) return "Retruco";
    if (game.truco.level === 4) return "Vale 4";
    return "Truco";
  };

  const getEnvidoStatus = () => {
    if (!game?.envido?.calls?.length) return "Sin Envido";

    return game.envido.calls
      .map((c) =>
        c === "envido"
          ? "Envido"
          : c === "real"
            ? "Real Envido"
            : c === "falta"
              ? "Falta Envido"
              : c,
      )
      .join(" → ");
  };

  const getLastEnvidoCallLabel = () => {
    const calls = game?.envido?.calls || [];
    const last = calls[calls.length - 1];

    if (!last) return "Envido";
    if (last === "envido") return "Envido";
    if (last === "real") return "Real Envido";
    if (last === "falta") return "Falta Envido";

    return "Envido";
  };

  const getPlayerLabel = (playerId) => {
    return playerId === user?.id ? "Vos" : "BOT";
  };

  const getLastActionMessage = () => {
    if (!game?.lastAction) return "";

    if (game.lastAction.type === "envido") {
      const winnerLabel = game.lastAction.winner === user.id ? "VOS" : "BOT";

      if (game.lastAction.accepted === false) {
        return `Envido no querido. ${winnerLabel} (+${game.lastAction.points})`;
      }

      return `Envido ganado por ${winnerLabel} con ${game.lastAction.winnerPoints} (+${game.lastAction.points})`;
    }

    if (game.lastAction.type === "truco") {
      const winnerLabel = game.lastAction.winner === user.id ? "VOS" : "BOT";
      return `Mano ganada por ${winnerLabel} (+${game.lastAction.points})`;
    }

    return "";
  };

  const isEnvidoWin = () => {
    return (
      game?.lastAction?.type === "envido" && game.lastAction.winner === user.id
    );
  };

  const getEnvidoSummaryTitle = () => {
    if (!game?.lastAction || game.lastAction.type !== "envido") return "";
    return isEnvidoWin() ? "Ganaron" : "Perdieron";
  };

  const getEnvidoSummaryLines = () => {
    if (!game?.lastAction || game.lastAction.type !== "envido") return [];

    return (game.lastAction.envidoSteps || []).map((step) => ({
      playerId: step.playerId,
      label: getPlayerLabel(step.playerId),
      value: step.value,
      isWinner:
        step.playerId === game.lastAction.winner && step.type === "points",
    }));
  };

  const getEnvidoBubbleForPlayer = (playerId) => {
    if (
      !game?.lastAction ||
      game.lastAction.type !== "envido" ||
      !game.lastAction.envidoSteps
    ) {
      return null;
    }

    const visibleSteps = game.lastAction.envidoSteps.slice(
      0,
      revealedEnvidoSteps,
    );
    const step = visibleSteps.find((s) => s.playerId === playerId);

    return step ? step.value : null;
  };

  const getResponseBubbleForPlayer = (playerId) => {
    if (!game?.responseBubble) return null;
    return game.responseBubble.playerId === playerId
      ? game.responseBubble.text
      : null;
  };

  const enqueueBubble = (playerId, bubble) => {
    if (!bubble?.text || !bubble?.key) return;

    if (!bubbleQueuesRef.current[playerId]) {
      bubbleQueuesRef.current[playerId] = [];
    }

    if (!bubbleSeenRef.current[playerId]) {
      bubbleSeenRef.current[playerId] = new Set();
    }

    if (bubbleSeenRef.current[playerId].has(bubble.key)) return;

    bubbleSeenRef.current[playerId].add(bubble.key);
    bubbleQueuesRef.current[playerId].push(bubble);

    playNextBubble(playerId);
  };

  const playNextBubble = (playerId) => {
    if (bubbleTimersRef.current[playerId]) return;

    const nextBubble = bubbleQueuesRef.current[playerId]?.shift();
    if (!nextBubble) return;

    setActiveBubbles((current) => ({
      ...current,
      [playerId]: nextBubble,
    }));

    bubbleTimersRef.current[playerId] = setTimeout(() => {
      setActiveBubbles((current) => ({
        ...current,
        [playerId]: null,
      }));

      bubbleTimersRef.current[playerId] = null;
      playNextBubble(playerId);
    }, nextBubble.duration ?? 1300);
  };

  const buildBubbleCandidate = (playerId) => {
    if (!game) return null;

    const response = getResponseBubbleForPlayer(playerId);
    if (response) {
      return {
        key: `${handSignature}-response-${playerId}-${game.responseBubble.id}-${response}`,
        text: response,
        className: "response-bubble",
        duration: 1200,
      };
    }

    const envidoBubble = getEnvidoBubbleForPlayer(playerId);
    if (envidoBubble) {
      return {
        key: `${handSignature}-envido-step-${game.lastAction?.resolutionId}-${playerId}-${envidoBubble}`,
        text: envidoBubble,
        className: "points-bubble",
        duration: 1400,
      };
    }

    if (game.envido?.pending && game.envido.caller === playerId) {
      return {
        key: `${handSignature}-pending-envido-${playerId}-${game.envido.calls.join("-")}`,
        text: getLastEnvidoCallLabel(),
        className: "",
        duration: 1200,
      };
    }

    if (
      !game.envido?.pending &&
      game.truco?.pending &&
      game.truco.caller === playerId
    ) {
      return {
        key: `${handSignature}-pending-truco-${playerId}-${game.truco.level}`,
        text: getPendingTrucoLabel(),
        className: "",
        duration: 1200,
      };
    }

    return null;
  };

  useEffect(() => {
    if (!game || !user) return;

    [user.id, "BOT"].forEach((playerId) => {
      const bubble = buildBubbleCandidate(playerId);
      if (bubble) enqueueBubble(playerId, bubble);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, user, revealedEnvidoSteps]);

  useEffect(() => {
    Object.values(bubbleTimersRef.current).forEach((timer) => {
      if (timer) clearTimeout(timer);
    });

    bubbleQueuesRef.current = {};
    bubbleTimersRef.current = {};
    bubbleSeenRef.current = {};
    setActiveBubbles({});
  }, [handSignature]);

  const getTableColumns = () => {
    if (!game?.table?.length) return [[], [], []];

    const columns = [[], [], []];

    game.table.forEach((cardPlay, index) => {
      const trickIndex = Math.floor(index / 2);
      if (trickIndex < 3) {
        columns[trickIndex].push({
          ...cardPlay,
          orderInTrick: index % 2,
        });
      }
    });

    return columns;
  };

  const getPlayedCardClass = (column, cardPlay) => {
    if (column.length < 2) return "card played table-card";

    const [first, second] = column;
    const firstValue = getCardTrucoValue(first.card);
    const secondValue = getCardTrucoValue(second.card);

    if (firstValue === secondValue) return "card played table-card";

    const winnerUserId =
      firstValue > secondValue ? first.userId : second.userId;

    return cardPlay.userId === winnerUserId
      ? "card played table-card winner-card"
      : "card played table-card loser-card";
  };

  const getCardTrucoValue = (card) => {
    const [num] = card.split("-");

    if (card === "1-espada") return 14;
    if (card === "1-basto") return 13;
    if (card === "7-espada") return 12;
    if (card === "7-oro") return 11;
    if (num === "3") return 10;
    if (num === "2") return 9;
    if (num === "1") return 8;
    if (num === "12") return 7;
    if (num === "11") return 6;
    if (num === "10") return 5;
    if (num === "7") return 4;
    if (num === "6") return 3;
    if (num === "5") return 2;
    if (num === "4") return 1;

    return 0;
  };

  const canCallEnvido = (type) => {
    if (!game || !user) return false;
    if (game.matchWinner) return false;
    if (game.envidoPlayed && !game.envido?.pending) return false;
    if (envidoLocked && !game.envido?.pending) return false;

    const trucoYaAceptado = game.truco?.level > 1 && !game.truco?.pending;
    if (trucoYaAceptado) return false;

    const envidoCount =
      game.envido?.calls?.filter((c) => c === "envido").length || 0;
    const hasReal = game.envido?.calls?.includes("real") || false;
    const hasFalta = game.envido?.calls?.includes("falta") || false;

    // si hay envido pendiente, solo puede subir el que responde
    if (game.envido?.pending) {
      if (game.envido.caller === user.id) return false;

      if (type === "envido") return envidoCount < 2 && !hasReal && !hasFalta;
      if (type === "real") return !hasReal && !hasFalta;
      if (type === "falta") return !hasFalta;

      return false;
    }

    if (game.firstCardPlayed?.[user.id]) return false;

    const isManoTurn = game.turn === user.id && game.table.length === 0;
    const isPieReplyWindow = game.turn === user.id && game.table.length === 1;

    const canReplyToPendingTrucoWithEnvido =
      game.truco?.pending &&
      game.truco.caller !== user.id &&
      !game.firstCardPlayed?.[user.id];

    return isManoTurn || isPieReplyWindow || canReplyToPendingTrucoWithEnvido;
  };

  const canCallTruco = () => {
    if (!game || !user) return false;
    if (game.matchWinner || game.winner) return false;
    if (game.envido?.pending) return false;
    if ((game.truco?.level ?? 1) >= 4) return false;

    if (game.truco?.pending) {
      return game.truco.caller !== user.id;
    }
    if (game.turn !== user.id) return false;

    if ((game.truco?.level ?? 1) === 1) return true;

    return game.truco?.canRaiseBy === user.id;
  };

  return (
    <div className="game-container">
      {!user && <button onClick={login}>Login</button>}

      {user && !game && <button onClick={playVsBot}>Jugar vs Bot</button>}

      {game && (
        <>
          {/* ===== BOT ===== */}
          <div className="bot-area">
            <div className="player-label">BOT</div>

            <div className="hand bot-hand">
              {(game.hands["BOT"] || []).map((_, i) => (
                <div key={i} className="card back" />
              ))}
            </div>

            <div className="bot-bubble-zone">
              {activeBubbles["BOT"] && (
                <div
                  className={`call-bubble bot-bubble ${activeBubbles["BOT"].className || ""
                    }`}
                >
                  {activeBubbles["BOT"].text}
                </div>
              )}
            </div>
          </div>

          {/* ===== CENTRO ===== */}
          <div className="center-area">
            <div className="left-panel">
              <div className="info-panel">
                <div>Turno: {game.turn === user.id ? "TUYO" : "BOT"}</div>
                <div>Truco: {getTrucoStatus()}</div>
                <div>Envido: {getEnvidoStatus()}</div>
              </div>

              {getLastActionMessage() && (
                <div className="event-panel">{getLastActionMessage()}</div>
              )}

              {game.lastAction?.type === "envido" &&
                game.lastAction.accepted !== false &&
                revealedEnvidoSteps >=
                (game.lastAction.envidoSteps?.length ?? 0) && (
                  <div
                    className={`envido-summary ${isEnvidoWin() ? "summary-win" : "summary-lose"
                      }`}
                  >
                    <div className="envido-summary-title">Envido</div>
                    <div className="envido-summary-result">
                      {getEnvidoSummaryTitle()}
                    </div>

                    {getEnvidoSummaryLines().map((line) => (
                      <div
                        key={line.playerId}
                        className={`envido-line ${line.isWinner ? "winner-line" : ""}`}
                      >
                        <span className="envido-line-label">{line.label}:</span>{" "}
                        {line.value}
                      </div>
                    ))}
                  </div>
                )}

              {game.matchWinner && (
                <div className="event-panel strong">
                  Ganador de la partida:{" "}
                  {game.matchWinner === user.id ? "VOS" : "BOT"}
                </div>
              )}
            </div>

            <div className="table-zone">
              {getTableColumns().map((column, columnIndex) => (
                <div key={columnIndex} className="trick-column">
                  <div className="trick-bot-slot">
                    {column
                      .filter((cardPlay) => cardPlay.userId === "BOT")
                      .map((cardPlay, i) => (
                        <div
                          key={`${columnIndex}-bot-${i}`}
                          className={getPlayedCardClass(column, cardPlay)}
                        >
                          <img
                            src={getCartaImg(cardPlay.card)}
                            alt={cardPlay.card}
                            className="card-img"
                          />
                        </div>
                      ))}
                  </div>

                  <div className="trick-player-slot">
                    {column
                      .filter((cardPlay) => cardPlay.userId !== "BOT")
                      .map((cardPlay, i) => (
                        <div
                          key={`${columnIndex}-player-${i}`}
                          className={getPlayedCardClass(column, cardPlay)}
                        >
                          <img
                            src={getCartaImg(cardPlay.card)}
                            alt={cardPlay.card}
                            className="card-img"
                          />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="right-panel">
              <div className="score-top">
                <MatchScore score={game.score?.["BOT"] ?? 0} label="Él" />
              </div>

              <div className="score-bottom">
                <MatchScore score={game.score?.[user.id] ?? 0} label="Yo" />
              </div>
            </div>
          </div>

          {/* ===== TU MANO ===== */}
          <div className="player-area">
            <div className="player-bubble-zone">
              {activeBubbles[user.id] && (
                <div
                  className={`call-bubble player-bubble ${activeBubbles[user.id].className || ""
                    }`}
                >
                  {activeBubbles[user.id].text}
                </div>
              )}
            </div>

            <div className="player-label"></div>

            <div className="hand">
              {game.hands[user.id]?.map((c) => (
                <button
                  key={c}
                  className={`card ${leavingCard === c ? "card-leaving" : ""}`}
                  disabled={
                    leavingCard ||
                    game.turn !== user.id ||
                    game.winner ||
                    game.matchWinner ||
                    game.truco?.pending ||
                    game.envido?.pending
                  }
                  onClick={() => playCard(c)}
                >
                  <img src={getCartaImg(c)} alt={c} className="card-img" />
                </button>
              ))}
            </div>
          </div>

          {/* ===== ACCIONES ===== */}
          <div className="actions">
            {/* CANTOS */}
            <div className="calls">
              <button
                disabled={!canCallEnvido("envido")}
                onClick={() =>
                  socket.emit("callEnvido", {
                    gameId: game.id,
                    userId: user.id,
                    type: "envido",
                  })
                }
              >
                Envido
              </button>

              <button
                disabled={!canCallEnvido("real")}
                onClick={() =>
                  socket.emit("callEnvido", {
                    gameId: game.id,
                    userId: user.id,
                    type: "real",
                  })
                }
              >
                Real Envido
              </button>

              <button
                disabled={!canCallEnvido("falta")}
                onClick={() =>
                  socket.emit("callEnvido", {
                    gameId: game.id,
                    userId: user.id,
                    type: "falta",
                  })
                }
              >
                Falta Envido
              </button>

              <button
                disabled={!canCallTruco()}
                onClick={() =>
                  socket.emit("callTruco", { gameId: game.id, userId: user.id })
                }
              >
                {getTrucoLabel()}
              </button>
            </div>

            {/* RESPUESTAS */}
            {(
              (game.envido?.pending && game.envido.caller !== user.id) ||
              (!game.envido?.pending &&
                game.truco?.pending &&
                game.truco.caller !== user.id)
            ) && (
                <div className="response">
                  <span>
                    {game.envido?.pending
                      ? `${getLastEnvidoCallLabel()}:`
                      : `${getPendingTrucoLabel()}:`}
                  </span>

                  <button
                    onClick={() =>
                      game.envido?.pending
                        ? socket.emit("respondEnvido", {
                          gameId: game.id,
                          userId: user.id,
                          accept: true,
                        })
                        : socket.emit("respondTruco", {
                          gameId: game.id,
                          userId: user.id,
                          accept: true,
                        })
                    }
                  >
                    Quiero
                  </button>

                  <button
                    onClick={() =>
                      game.envido?.pending
                        ? socket.emit("respondEnvido", {
                          gameId: game.id,
                          userId: user.id,
                          accept: false,
                        })
                        : socket.emit("respondTruco", {
                          gameId: game.id,
                          userId: user.id,
                          accept: false,
                        })
                    }
                  >
                    No Quiero
                  </button>
                </div>
              )}
          </div>

          <div className="result">
            <div className="result">
              {game.matchWinner ? (
                <button onClick={newMatch}>Nueva partida</button>
              ) : game.winner ? (
                <>
                  <button onClick={nextHand}>Siguiente mano</button>
                  <button onClick={newMatch}>Nueva partida</button>
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
