import { useState, useEffect, useRef } from "react";
import io, { Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Flame, LogOut, RefreshCw, Key, Mail, User as UserIcon, Volume2, Shield, ArrowLeft, Coins, Award, HelpCircle } from "lucide-react";
import "./App.css";
import { getCartaImg } from "./utils/cartas";
import { soundEffects } from "./utils/soundEffects";
import { getEnvidoInfo } from "./utils/envido";
import { GameState, User, Score, CardPlay, EnvidoStep } from "./types";

// Setup Socket.IO Client with autoConnect disabled (auth handshake runs on connection)
const socket: Socket = io("http://localhost:3000", { autoConnect: false });

interface MatchScoreProps {
  score: number;
  label: string;
}

function MatchScore({ score, label }: MatchScoreProps) {
  const cappedScore = Math.min(score, 30);
  const isBuenas = cappedScore >= 15;
  const cycleScore = isBuenas ? cappedScore - 15 : cappedScore;

  const renderBox = (pointsInBox: number, boxIndex: number) => {
    const active = Math.max(0, Math.min(pointsInBox, 5));

    return (
      <div key={boxIndex} className="match-box">
        <div className={`match-stick-css top ${active >= 1 ? "active" : "inactive"}`} />
        <div className={`match-stick-css right ${active >= 2 ? "active" : "inactive"}`} />
        <div className={`match-stick-css bottom ${active >= 3 ? "active" : "inactive"}`} />
        <div className={`match-stick-css left ${active >= 4 ? "active" : "inactive"}`} />
        <div className={`match-stick-css diagonal ${active >= 5 ? "active" : "inactive"}`} />
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
      <div className={`score-cycle ${isBuenas ? "buenas-cycle" : "malas-cycle"}`}>
        <div className="score-boxes">{boxes}</div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<"login" | "menu" | "settings" | "account" | "lobby" | "game">("login");
  const [authTab, setAuthTab] = useState<"login" | "register" | "verify">("login");

  // Auth Inputs
  const [usernameInput, setUsernameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [verifyEmailInput, setVerifyEmailInput] = useState("");
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [registerStep, setRegisterStep] = useState<1 | 2>(1);

  // Toast notifications state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (message: string, type: "success" | "error") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Account inputs
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("default_avatar");

  // Config/Ajustes states
  const [volume, setVolume] = useState(0.5);

  // Envido Modal and advanced timing states
  const [delayedShowEnvidoModal, setDelayedShowEnvidoModal] = useState(false);
  const [allowContinue, setAllowContinue] = useState(false);
  const [popupActiveTimer, setPopupActiveTimer] = useState(false);
  const [displayedScore, setDisplayedScore] = useState<Record<string, number>>({});

  const [envidoLocked, setEnvidoLocked] = useState(false);
  const [revealedEnvidoSteps, setRevealedEnvidoSteps] = useState(0);
  const [leavingCard, setLeavingCard] = useState<string | null>(null);
  const [activeBubbles, setActiveBubbles] = useState<Record<string, any>>({});
  const [forceHideEnvidoModal, setForceHideEnvidoModal] = useState(false);
  const [showEnvidoDropdown, setShowEnvidoDropdown] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  const bubbleQueuesRef = useRef<Record<string, any[]>>({});
  const bubbleTimersRef = useRef<Record<string, any | null>>({});
  const bubbleSeenRef = useRef<Record<string, Set<string>>>({});
  const hasShimmeredRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handSignature = game?.initialHands
    ? JSON.stringify(game.initialHands)
    : "";

  // Verify session on app load
  useEffect(() => {
    const verifySession = async () => {
      const token = localStorage.getItem("truco_token");
      if (!token) {
        setScreen("login");
        return;
      }
      try {
        const res = await fetch("http://localhost:3000/auth/me", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (res.ok && data.user) {
          setUser(data.user);
          setSelectedAvatar(data.user.avatarUrl || "default_avatar");
          
          socket.auth = { token };
          socket.connect();
          
          setScreen("menu");
        } else {
          localStorage.removeItem("truco_token");
          setScreen("login");
        }
      } catch (e) {
        localStorage.removeItem("truco_token");
        setScreen("login");
      }
    };
    verifySession();
  }, []);

  // Fetch volume settings on mount
  useEffect(() => {
    const savedVol = localStorage.getItem("truco_volume");
    if (savedVol !== null) {
      const vol = parseFloat(savedVol);
      setVolume(vol);
      soundEffects.setVolume(vol);
    } else {
      soundEffects.setVolume(0.5);
    }
  }, []);

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    soundEffects.setVolume(newVol);
    localStorage.setItem("truco_volume", newVol.toString());
  };

  // Socket updates
  useEffect(() => {
    socket.on("updateGame", (g: GameState) => {
      setGame({ ...g });
    });

    return () => {
      socket.off("updateGame");
    };
  }, []);

  // Outside click listener for the dropdown menu
  useEffect(() => {
    setIsTouch(!window.matchMedia("(hover: hover)").matches);

    function handleClickOutside(event: Event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowEnvidoDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // Play deal sound when hands are reset
  useEffect(() => {
    if (handSignature) {
      soundEffects.playCardDeal();
      hasShimmeredRef.current = false;
    }
  }, [handSignature]);

  const lastTableLengthRef = useRef(0);

  // Play card sound when a card lands on the table
  useEffect(() => {
    if (game && game.table) {
      const currentLength = game.table.length;
      if (currentLength > lastTableLengthRef.current) {
        const lastPlay = game.table[currentLength - 1];
        if (lastPlay) {
          soundEffects.playCard(lastPlay.card);
        }
      }
      lastTableLengthRef.current = currentLength;
    } else {
      lastTableLengthRef.current = 0;
    }
  }, [game?.table?.length]);

  // Clean modals when envido changes
  useEffect(() => {
    setForceHideEnvidoModal(false);
  }, [game?.lastAction?.resolutionId]);

  // Victory Confetti trigger
  useEffect(() => {
    if (game?.matchWinner && user && game.matchWinner === user.id) {
      soundEffects.playVictory();
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#ffd700", "#ffffff", "#2e7d32", "#a8202a"],
      });
      // Fetch fresh stats on match victory
      const token = localStorage.getItem("truco_token");
      if (token) {
        fetch("http://localhost:3000/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        }).then(res => res.json()).then(data => {
          if (data.user) {
            setUser(data.user);
          }
        }).catch(err => console.log(err));
      }
    }
  }, [game?.matchWinner, user]);

  // Envido Glow Sound effect (Shimmer)
  const { points: envidoPointsVal, contributorCards: envidoContributors } = getEnvidoInfo(
    game?.hands[user?.id || ""] || []
  );

  useEffect(() => {
    if (envidoPointsVal >= 29 && !hasShimmeredRef.current && game?.turn === user?.id) {
      soundEffects.playShimmer();
      hasShimmeredRef.current = true;
    }
  }, [envidoPointsVal, game?.turn, user?.id]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

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
    let hideTimeout: any;

    const interval = setInterval(() => {
      index += 1;
      setRevealedEnvidoSteps(index);

      if (index >= (game.lastAction?.envidoSteps?.length ?? 0)) {
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
  }, [game?.lastAction?.resolutionId]);

  // Synchronize displayedScore with game.score, but defer it during Envido resolutions
  useEffect(() => {
    if (!game || !user) {
      setDisplayedScore({});
      return;
    }
    const isEnvidoActive = game.lastAction?.type === "envido";
    if (isEnvidoActive) {
      if (delayedShowEnvidoModal) {
        setDisplayedScore({ ...game.score });
      }
    } else {
      setDisplayedScore({ ...game.score });
    }
  }, [game?.score, delayedShowEnvidoModal, game?.lastAction?.resolutionId]);

  // Clean advanced timing states when game is reset/finished
  useEffect(() => {
    if (!game) {
      setDelayedShowEnvidoModal(false);
      setAllowContinue(false);
      setPopupActiveTimer(false);
    }
  }, [game]);

  // Handle advanced timing for Envido modal and card freeze
  useEffect(() => {
    if (!game || !user || game.lastAction?.type !== "envido" || forceHideEnvidoModal) {
      setDelayedShowEnvidoModal(false);
      setAllowContinue(false);
      setPopupActiveTimer(false);
      return;
    }

    const isAccepted = game.lastAction.accepted !== false;

    if (isAccepted) {
      const stepsLength = game.lastAction.envidoSteps?.length ?? 0;
      if (revealedEnvidoSteps >= stepsLength && stepsLength > 0) {
        const t1 = setTimeout(() => {
          setDelayedShowEnvidoModal(true);
          setPopupActiveTimer(true);

          setAllowContinue(false);
          const t2 = setTimeout(() => {
            setAllowContinue(true);
          }, 1500);

          const t3 = setTimeout(() => {
            setPopupActiveTimer(false);
          }, 3000);

          return () => {
            clearTimeout(t2);
            clearTimeout(t3);
          };
        }, 1500);

        return () => clearTimeout(t1);
      }
    } else {
      // Envido was rejected, wait 1.5s then show the modal
      const t1 = setTimeout(() => {
        setDelayedShowEnvidoModal(true);
        setPopupActiveTimer(true);

        setAllowContinue(false);
        const t2 = setTimeout(() => {
          setAllowContinue(true);
        }, 1500);

        const t3 = setTimeout(() => {
          setPopupActiveTimer(false);
        }, 3000);

        return () => {
          clearTimeout(t2);
          clearTimeout(t3);
        };
      }, 1500);

      return () => clearTimeout(t1);
    }
  }, [game?.lastAction?.resolutionId, revealedEnvidoSteps, forceHideEnvidoModal]);

  // Auth Operations
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!usernameInput.trim() || !passwordInput.trim()) {
      showToast("Usuario y contraseña son requeridos", "error");
      return;
    }
    soundEffects.playClick();

    try {
      const res = await fetch("http://localhost:3000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput.trim(), password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.email) {
          setVerifyEmailInput(data.email);
          setAuthTab("verify");
          showToast("Cuenta no verificada. Por favor ingresá el código enviado.", "error");
        } else {
          showToast(data.error || "Error al iniciar sesión", "error");
        }
        return;
      }
      localStorage.setItem("truco_token", data.token);
      setUser(data.user);
      setSelectedAvatar(data.user.avatarUrl || "default_avatar");
      
      socket.auth = { token: data.token };
      socket.connect();

      setScreen("menu");
      setPasswordInput("");
    } catch (err) {
      showToast("Error de conexión con el servidor", "error");
    }
  };

  const handleNextStep = async () => {
    const username = usernameInput.trim();
    const email = emailInput.trim();

    if (!username || !email) {
      showToast("Todos los campos son obligatorios", "error");
      return;
    }

    // Username validation: min 4, max 12, alphanumeric
    const usernameRegex = /^[a-zA-Z0-9]{4,12}$/;
    if (!usernameRegex.test(username)) {
      showToast("El usuario debe tener entre 4 y 12 caracteres y ser alfanumérico (letras y números, sin espacios).", "error");
      return;
    }

    // Email validation: simple regex format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast("Ingresá un correo electrónico válido.", "error");
      return;
    }

    soundEffects.playClick();

    try {
      const res = await fetch("http://localhost:3000/auth/check-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al verificar disponibilidad", "error");
        return;
      }
      setRegisterStep(2);
    } catch (err) {
      showToast("Error de conexión con el servidor", "error");
    }
  };

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (registerStep === 1) {
      await handleNextStep();
      return;
    }

    if (!passwordInput || !confirmPasswordInput) {
      showToast("Todos los campos son obligatorios", "error");
      return;
    }

    // Password validation: min 8, max 16, must contain letter and number
    const pass = passwordInput;
    if (pass.length < 8 || pass.length > 16) {
      showToast("La contraseña debe tener entre 8 y 16 caracteres.", "error");
      return;
    }
    if (!/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
      showToast("La contraseña debe contener al menos una letra y un número.", "error");
      return;
    }

    if (passwordInput !== confirmPasswordInput) {
      showToast("Las contraseñas no coinciden.", "error");
      return;
    }

    soundEffects.playClick();

    try {
      const res = await fetch("http://localhost:3000/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.trim(),
          email: emailInput.trim(),
          password: passwordInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al registrarse", "error");
        return;
      }
      showToast("¡Registro exitoso! Copiá tu código de verificación.", "success");
      setVerifyEmailInput(emailInput.trim());
      setAuthTab("verify");
      setPasswordInput("");
      setConfirmPasswordInput("");
      setEmailInput("");
      setUsernameInput("");
      setRegisterStep(1);
    } catch (err) {
      showToast("Error de conexión con el servidor", "error");
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!verifyEmailInput.trim() || !verifyCodeInput.trim()) {
      showToast("Correo y código son requeridos", "error");
      return;
    }
    soundEffects.playClick();

    try {
      const res = await fetch("http://localhost:3000/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifyEmailInput.trim(),
          token: verifyCodeInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Código incorrecto", "error");
        return;
      }
      showToast("Cuenta verificada con éxito. Ya podés iniciar sesión.", "success");
      setAuthTab("login");
      setVerifyCodeInput("");
    } catch (err) {
      showToast("Error de conexión con el servidor", "error");
    }
  };

  const handleResendCode = async () => {
    if (!verifyEmailInput.trim()) {
      showToast("Ingresá tu correo electrónico para reenviar el código", "error");
      return;
    }
    soundEffects.playClick();

    try {
      const res = await fetch("http://localhost:3000/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifyEmailInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al reenviar el código", "error");
        return;
      }
      showToast(data.message || "Se ha enviado un nuevo código de verificación.", "success");
      setResendCooldown(30);
    } catch (err) {
      showToast("Error de conexión con el servidor", "error");
    }
  };

  const logout = () => {
    soundEffects.playClick();
    localStorage.removeItem("truco_token");
    socket.disconnect();
    setUser(null);
    setGame(null);
    setScreen("login");
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      showToast("Ambas contraseñas son requeridas", "error");
      return;
    }
    soundEffects.playClick();

    const token = localStorage.getItem("truco_token");
    try {
      const res = await fetch("http://localhost:3000/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al cambiar contraseña", "error");
        return;
      }
      showToast("Contraseña cambiada exitosamente", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      showToast("Error de conexión con el servidor", "error");
    }
  };

  const handleUpdateAvatar = async (avatarName: string) => {
    soundEffects.playClick();
    const token = localStorage.getItem("truco_token");
    try {
      const res = await fetch("http://localhost:3000/auth/update-avatar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ avatarUrl: avatarName }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setUser(data.user);
        setSelectedAvatar(data.user.avatarUrl || "default_avatar");
      }
    } catch (err) {
      console.error("Error al actualizar avatar:", err);
    }
  };

  const getAvatarEmoji = (url?: string) => {
    if (url === "cowboy") return "🤠";
    if (url === "ninja") return "🥷";
    if (url === "wizard") return "🧙";
    if (url === "pirate") return "🏴‍☠️";
    if (url === "gamer") return "🎮";
    if (url === "king") return "👑";
    return "👤";
  };

  const playVsBot = async () => {
    if (!user) return;
    soundEffects.playClick();

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

  const playCard = (card: string) => {
    if (leavingCard || !game || !user) return;

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
    if (!game) return;
    soundEffects.playClick();

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

  const fold = () => {
    if (!game || !user) return;
    soundEffects.playClick();
    socket.emit("fold", { gameId: game.id, userId: user.id });
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
              : c
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

  const getPlayerLabel = (playerId: string) => {
    return playerId === user?.id ? "Vos" : "BOT";
  };

  const getLastActionMessage = () => {
    if (!game || !user || !game.lastAction) return "";

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

    if (game.lastAction.type === "fold") {
      const winnerLabel = game.lastAction.winner === user.id ? "VOS" : "BOT";
      return `${winnerLabel === "VOS" ? "BOT" : "VOS"} se fue al mazo. Gana ${winnerLabel} (+${game.lastAction.points})`;
    }

    return "";
  };

  const isEnvidoWin = () => {
    return (
      game?.lastAction?.type === "envido" && game.lastAction.winner === user?.id
    );
  };

  const getEnvidoSummaryTitle = () => {
    if (!game?.lastAction || game.lastAction.type !== "envido") return "";
    return isEnvidoWin() ? "¡Ganaste!" : "Perdiste";
  };

  const getEnvidoSummaryLines = () => {
    if (!game?.lastAction || game.lastAction.type !== "envido") return [];

    return (game.lastAction.envidoSteps || []).map((step) => ({
      playerId: step.playerId,
      label: getPlayerLabel(step.playerId),
      value: step.value,
      isWinner:
        step.playerId === game.lastAction?.winner && step.type === "points",
    }));
  };

  const getEnvidoBubbleForPlayer = (playerId: string) => {
    if (
      !game?.lastAction ||
      game.lastAction.type !== "envido" ||
      !game.lastAction.envidoSteps
    ) {
      return null;
    }

    const visibleSteps = game.lastAction.envidoSteps.slice(
      0,
      revealedEnvidoSteps
    );
    const step = visibleSteps.find((s) => s.playerId === playerId);

    return step ? step.value : null;
  };

  const getResponseBubbleForPlayer = (playerId: string) => {
    if (!game?.responseBubble) return null;
    return game.responseBubble.playerId === playerId
      ? game.responseBubble.text
      : null;
  };

  const enqueueBubble = (playerId: string, bubble: any) => {
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

  const playNextBubble = (playerId: string) => {
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

  const buildBubbleCandidate = (playerId: string) => {
    if (!game) return null;

    const response = getResponseBubbleForPlayer(playerId);
    if (response) {
      return {
        key: `${handSignature}-response-${playerId}-${game.responseBubble?.id}-${response}`,
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

    const columns: CardPlay[][] = [[], [], []];

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

  const getPlayedCardClass = (column: CardPlay[], cardPlay: CardPlay) => {
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

  const getCardTrucoValue = (card: string) => {
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

  const canCallEnvido = (type: string) => {
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

  const isUserTurn = () => {
    if (!game || !user) return false;
    return (
      game.turn === user.id &&
      !game.winner &&
      !game.matchWinner &&
      !game.truco?.pending &&
      !game.envido?.pending
    );
  };

  const showEnvidoModal =
    game?.lastAction?.type === "envido" &&
    game.lastAction.accepted !== false &&
    revealedEnvidoSteps >= (game.lastAction.envidoSteps?.length ?? 0) &&
    !forceHideEnvidoModal;

  return (
    <div className="game-container">
      {/* ===== LOGIN / REGISTER / VERIFY SCREEN ===== */}
      {screen === "login" && (
        <div className="login-screen-overlay">
          <motion.div
            className="login-card"
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            <div className="login-header">
              <div className="trophy-badge">🏆</div>
              <h1>Truco Argentino</h1>
              <p>El juego nacional de cartas</p>
            </div>

            <div className="auth-tabs">
              <button 
                className={`auth-tab-btn ${authTab === "login" ? "active" : ""}`}
                onClick={() => setAuthTab("login")}
              >
                Ingresar
              </button>
              <button 
                className={`auth-tab-btn ${authTab === "register" ? "active" : ""}`}
                onClick={() => {
                  setAuthTab("register");
                  setRegisterStep(1);
                  setPasswordInput("");
                  setConfirmPasswordInput("");
                }}
              >
                Registrarse
              </button>
              <button 
                className={`auth-tab-btn ${authTab === "verify" ? "active" : ""}`}
                onClick={() => setAuthTab("verify")}
              >
                Verificar
              </button>
            </div>

            <div className="login-body">
              <AnimatePresence mode="wait">
                {authTab === "login" && (
                  <motion.div
                    key="login"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <form onSubmit={handleLogin} className="auth-form">
                      <div className="input-group">
                        <UserIcon size={18} className="input-icon" />
                        <input
                          type="text"
                          placeholder="Nombre de usuario"
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          maxLength={14}
                        />
                      </div>
                      <div className="input-group">
                        <Key size={18} className="input-icon" />
                        <input
                          type="password"
                          placeholder="Contraseña"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="login-btn">
                        Iniciar Sesión
                      </button>
                    </form>
                  </motion.div>
                )}

                {authTab === "register" && (
                  <motion.div
                    key="register"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <form onSubmit={handleRegister} className="auth-form" style={{ overflow: "hidden" }}>
                      <AnimatePresence mode="wait">
                        {registerStep === 1 ? (
                          <motion.div
                            key="step1"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="auth-form-step"
                            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
                          >
                            <div className="input-group">
                              <UserIcon size={18} className="input-icon" />
                              <input
                                type="text"
                                placeholder="Nombre de usuario"
                                value={usernameInput}
                                onChange={(e) => setUsernameInput(e.target.value)}
                                maxLength={12}
                              />
                            </div>
                            <div className="input-group">
                              <Mail size={18} className="input-icon" />
                              <input
                                type="email"
                                placeholder="Correo electrónico"
                                value={emailInput}
                                onChange={(e) => setEmailInput(e.target.value)}
                              />
                            </div>
                            <button type="submit" className="login-btn">
                              Siguiente
                            </button>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="step2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="auth-form-step"
                            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
                          >
                            <div className="input-group">
                              <Key size={18} className="input-icon" />
                              <input
                                type="password"
                                placeholder="Contraseña"
                                value={passwordInput}
                                onChange={(e) => setPasswordInput(e.target.value)}
                              />
                            </div>
                            <div className="input-group">
                              <Key size={18} className="input-icon" />
                              <input
                                type="password"
                                placeholder="Confirmar contraseña"
                                value={confirmPasswordInput}
                                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                              />
                            </div>
                            <div className="register-actions-row">
                              <button
                                type="button"
                                className="register-back-btn"
                                onClick={() => {
                                  soundEffects.playClick();
                                  setRegisterStep(1);
                                }}
                              >
                                <ArrowLeft size={20} />
                              </button>
                              <button type="submit" className="login-btn">
                                Crear Cuenta
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </form>
                  </motion.div>
                )}

                {authTab === "verify" && (
                  <motion.div
                    key="verify"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <form onSubmit={handleVerify} className="auth-form">
                      <div className="input-group">
                        <Mail size={18} className="input-icon" />
                        <input
                          type="email"
                          className="has-action-btn"
                          placeholder="Correo electrónico"
                          value={verifyEmailInput}
                          onChange={(e) => setVerifyEmailInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="input-action-btn"
                          onClick={handleResendCode}
                          disabled={resendCooldown > 0}
                        >
                          {resendCooldown > 0 ? `${resendCooldown}s` : "Enviar código"}
                        </button>
                      </div>
                      <div className="input-group">
                        <Shield size={18} className="input-icon" />
                        <input
                          type="text"
                          placeholder="Código de 6 dígitos"
                          value={verifyCodeInput}
                          onChange={(e) => setVerifyCodeInput(e.target.value)}
                          maxLength={6}
                        />
                      </div>
                      <button type="submit" className="login-btn">
                        Verificar Cuenta
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}

      {/* ===== MAIN MENU SCREEN ===== */}
      {screen === "menu" && user && (
        <div className="lobby-screen-overlay">
          <motion.div
            className="lobby-card main-menu-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="menu-header">
              <div className="trophy-badge small">🏆</div>
              <h1>Truco Argentino</h1>
              <p>Menú Principal</p>
            </div>

            <div className="user-profile-summary">
              <div className="user-avatar">{getAvatarEmoji(user.avatarUrl)}</div>
              <div className="user-profile-details">
                <h2>{user.username}</h2>
                <div className="user-coins-pill">
                  <Coins size={14} className="coin-icon-menu" />
                  <span>{user.coins ?? 1000} monedas</span>
                </div>
              </div>
            </div>

            <div className="lobby-actions menu-actions">
              <button className="lobby-action-btn primary" onClick={() => { soundEffects.playClick(); setScreen("lobby"); }}>
                🎮 Jugar
              </button>
              <button className="lobby-action-btn secondary" onClick={() => { soundEffects.playClick(); setScreen("account"); }}>
                👤 Cuenta y Perfil
              </button>
              <button className="lobby-action-btn secondary" onClick={() => { soundEffects.playClick(); setScreen("settings"); }}>
                ⚙️ Ajustes
              </button>
              <button className="lobby-action-btn logout-btn-menu" onClick={logout}>
                🚪 Cerrar Sesión
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ===== LOBBY (PLAY MODE SELECTION) ===== */}
      {screen === "lobby" && user && (
        <div className="lobby-screen-overlay">
          <motion.div
            className="lobby-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="screen-header">
              <button className="back-btn" onClick={() => { soundEffects.playClick(); setScreen("menu"); }}>
                <ArrowLeft size={18} />
              </button>
              <h2>Modos de Juego</h2>
            </div>

            <div className="lobby-actions" style={{ marginTop: "20px" }}>
              <button className="lobby-action-btn primary" onClick={playVsBot}>
                🤖 Contra la Inteligencia Artificial
              </button>
              <button className="lobby-action-btn secondary" disabled>
                🌐 Multijugador Online (Próximamente)
              </button>
              <button className="lobby-action-btn secondary" disabled>
                👥 Torneos 2v2 (Próximamente)
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ===== SETTINGS (AJUSTES) ===== */}
      {screen === "settings" && user && (
        <div className="lobby-screen-overlay">
          <motion.div
            className="lobby-card settings-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="screen-header">
              <button className="back-btn" onClick={() => { soundEffects.playClick(); setScreen("menu"); }}>
                <ArrowLeft size={18} />
              </button>
              <h2>Configuración</h2>
            </div>

            <div className="settings-body">
              <div className="settings-group">
                <div className="settings-label-row">
                  <Volume2 size={20} />
                  <span>Volumen General</span>
                  <span className="vol-percent">{Math.round(volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="volume-slider"
                />
              </div>

              <div className="settings-info-card">
                <HelpCircle size={18} />
                <p>Las partidas guardan automáticamente tu historial de victorias y derrotas en la base de datos.</p>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ===== ACCOUNT (CUENTA Y PERFIL) ===== */}
      {screen === "account" && user && (
        <div className="lobby-screen-overlay">
          <motion.div
            className="lobby-card account-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="screen-header">
              <button className="back-btn" onClick={() => { soundEffects.playClick(); setScreen("menu"); }}>
                <ArrowLeft size={18} />
              </button>
              <h2>Mi Cuenta</h2>
            </div>

            <div className="account-scroll-container">
              {/* Stats Block */}
              <div className="account-section">
                <h3>Estadísticas de Partidas</h3>
                <div className="stats-grid">
                  <div className="stat-pill wins">
                    <Award size={16} />
                    <span>Victorias: <strong>{user.wins ?? 0}</strong></span>
                  </div>
                  <div className="stat-pill losses">
                    <Award size={16} />
                    <span>Derrotas: <strong>{user.losses ?? 0}</strong></span>
                  </div>
                  <div className="stat-pill coins">
                    <Coins size={16} />
                    <span>Monedas: <strong>{user.coins ?? 1000}</strong></span>
                  </div>
                  <div className="stat-pill rate">
                    <Flame size={16} />
                    <span>Efectividad: <strong>
                      {((user.wins ?? 0) + (user.losses ?? 0)) > 0
                        ? `${Math.round(((user.wins ?? 0) / ((user.wins ?? 0) + (user.losses ?? 0))) * 100)}%`
                        : "0%"}
                    </strong></span>
                  </div>
                </div>
              </div>

              {/* Avatar Selector */}
              <div className="account-section">
                <h3>Selecciona tu Avatar</h3>
                <div className="avatar-grid">
                  {[
                    { name: "default_avatar", emoji: "👤" },
                    { name: "cowboy", emoji: "🤠" },
                    { name: "ninja", emoji: "🥷" },
                    { name: "wizard", emoji: "🧙" },
                    { name: "pirate", emoji: "🏴‍☠️" },
                    { name: "gamer", emoji: "🎮" },
                    { name: "king", emoji: "👑" },
                  ].map((av) => (
                    <button
                      key={av.name}
                      className={`avatar-select-btn ${selectedAvatar === av.name ? "selected" : ""}`}
                      onClick={() => handleUpdateAvatar(av.name)}
                    >
                      <span className="avatar-emoji">{av.emoji}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Change Password Form */}
              <div className="account-section">
                <h3>Cambiar Contraseña</h3>

                <form onSubmit={handleChangePassword} className="auth-form password-form">
                  <div className="input-group">
                    <Key size={18} className="input-icon" />
                    <input
                      type="password"
                      placeholder="Contraseña actual"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div className="input-group">
                    <Key size={18} className="input-icon" />
                    <input
                      type="password"
                      placeholder="Nueva contraseña"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="login-btn password-submit-btn">
                    Actualizar Contraseña
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ===== MAIN GAME BOARD ===== */}
      {user && game && (
        <>
          {/* ENVIDO POPUP MODAL */}
          <AnimatePresence>
            {delayedShowEnvidoModal && (
              <motion.div
                className="envido-modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className={`envido-modal ${isEnvidoWin() ? "winner-modal" : "loser-modal"}`}
                  initial={{ scale: 0.85, opacity: 0, y: 30 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.85, opacity: 0, y: 30 }}
                  transition={{ type: "spring", damping: 20 }}
                >
                  <div className="envido-modal-header">
                    <Flame className="envido-modal-icon" size={32} />
                    <h2>{isEnvidoWin() ? "¡Ganaste el Envido!" : "Perdiste el Envido"}</h2>
                  </div>
                  <div className="envido-modal-body">
                    <div className="envido-modal-result-title">
                      {getEnvidoSummaryTitle()} (+{game.lastAction?.points} {game.lastAction?.points === 1 ? "punto" : "puntos"})
                    </div>
                    {game.lastAction?.accepted === false ? (
                      <div className="envido-modal-rejected-msg">
                        {game.lastAction.winner === user.id ? "El rival no quiso el Envido" : "No quisiste el Envido"}
                      </div>
                    ) : (
                      <div className="envido-modal-lines">
                        {getEnvidoSummaryLines().map((line) => (
                          <div
                            key={line.playerId}
                            className={`envido-modal-line ${line.isWinner ? "winner-line" : ""}`}
                          >
                            <span className="envido-line-label">{line.label}:</span>{" "}
                            <span className="envido-line-value">{line.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="envido-modal-footer">
                    <button 
                      className="envido-modal-btn" 
                      disabled={!allowContinue}
                      onClick={() => {
                        soundEffects.playClick();
                        setForceHideEnvidoModal(true);
                      }}
                    >
                      Continuar jugando
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ===== BOT AREA ===== */}
          <div className="bot-area">
            <div className="player-label-indicator">🤖 BOT</div>

            <div className="hand bot-hand">
              {(game.hands["BOT"] || []).map((_, i) => (
                <div key={i} className="card back" />
              ))}
            </div>

            <div className="bot-bubble-zone">
              {activeBubbles["BOT"] && (
                <div className={`call-bubble bot-bubble ${activeBubbles["BOT"].className || ""}`}>
                  {activeBubbles["BOT"].text}
                </div>
              )}
            </div>
          </div>

          {/* ===== CENTER TABLE AREA ===== */}
          <div className="center-area">
            <div className="left-panel">
              <div className="info-panel">
                <div className="info-turn">
                  Turno: <span className={isUserTurn() ? "your-turn" : "bot-turn"}>{game.turn === user.id ? "TUYO" : "BOT"}</span>
                </div>
                <div className="info-stats">
                  <div>Truco: <strong>{getTrucoStatus()}</strong></div>
                  <div>Envido: <strong>{getEnvidoStatus()}</strong></div>
                </div>
              </div>

              {getLastActionMessage() && !showEnvidoModal && (
                <div className="event-panel">{getLastActionMessage()}</div>
              )}

              {game.matchWinner && (
                <div className="event-panel strong">
                  🏆 Ganador de la partida:{" "}
                  <strong>{game.matchWinner === user.id ? "VOS" : "BOT"}</strong>
                </div>
              )}
            </div>

            <div className="table-zone game-table">
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
                <MatchScore score={displayedScore["BOT"] !== undefined ? displayedScore["BOT"] : (game.score?.["BOT"] ?? 0)} label="Él" />
              </div>

              <div className="score-bottom">
                <MatchScore score={displayedScore[user.id] !== undefined ? displayedScore[user.id] : (game.score?.[user.id] ?? 0)} label="Yo" />
              </div>
            </div>
          </div>

          {/* ===== PLAYER AREA (USER) ===== */}
          <div className="player-area">
            <div className="player-bubble-zone">
              {activeBubbles[user.id] && (
                <div className={`call-bubble player-bubble ${activeBubbles[user.id].className || ""}`}>
                  {activeBubbles[user.id].text}
                </div>
              )}
            </div>

            <div className="player-label-indicator">👤 {user.username}</div>

            <div className="hand">
              {game.hands[user.id]?.map((c) => {
                const isGlow = envidoPointsVal >= 29 && envidoContributors.includes(c) && !game.firstCardPlayed[user.id];
                return (
                  <button
                    key={c}
                    className={`card ${leavingCard === c ? "card-leaving" : ""} ${isGlow ? "card-glow" : ""}`}
                    disabled={
                      leavingCard !== null ||
                      game.turn !== user.id ||
                      game.winner !== null ||
                      game.matchWinner !== null ||
                      game.truco?.pending ||
                      game.envido?.pending ||
                      popupActiveTimer
                    }
                    onClick={() => playCard(c)}
                  >
                    <img src={getCartaImg(c)} alt={c} className="card-img" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* ===== ACTION BUTTONS ZONE ===== */}
          <div className="actions">
            {/* CALLS */}
            <div className="calls">
              
              {/* COLLAPSIBLE ENVIDO DROPDOWN */}
              <div 
                ref={dropdownRef}
                className="envido-dropdown-container"
                onMouseLeave={() => {
                  if (isTouch) return;
                  setShowEnvidoDropdown(false);
                }}
              >
                <AnimatePresence>
                  {showEnvidoDropdown && (
                    <motion.div 
                      className="envido-dropdown-menu"
                      initial={{ opacity: 0, y: 10, x: "-50%", scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
                      exit={{ opacity: 0, y: 10, x: "-50%", scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                    >
                      <button
                        className="btn-envido dropdown-item"
                        disabled={!canCallEnvido("falta")}
                        onClick={() => {
                          soundEffects.playClick();
                          socket.emit("callEnvido", {
                            gameId: game.id,
                            userId: user.id,
                            type: "falta",
                          });
                          setShowEnvidoDropdown(false);
                        }}
                      >
                        Falta Envido
                      </button>

                      <button
                        className="btn-envido dropdown-item"
                        disabled={!canCallEnvido("real")}
                        onClick={() => {
                          soundEffects.playClick();
                          socket.emit("callEnvido", {
                            gameId: game.id,
                            userId: user.id,
                            type: "real",
                          });
                          setShowEnvidoDropdown(false);
                        }}
                      >
                        Real Envido
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="envido-split-btn-group">
                  <button
                    className="btn-envido main-split-btn"
                    disabled={!canCallEnvido("envido")}
                    onMouseEnter={() => {
                      if (isTouch) return;
                      setShowEnvidoDropdown(false);
                    }}
                    onClick={() => {
                      soundEffects.playClick();
                      if (isTouch) {
                        if (!showEnvidoDropdown) {
                          setShowEnvidoDropdown(true);
                        } else {
                          socket.emit("callEnvido", {
                            gameId: game.id,
                            userId: user.id,
                            type: "envido",
                          });
                          setShowEnvidoDropdown(false);
                        }
                      } else {
                        socket.emit("callEnvido", {
                          gameId: game.id,
                          userId: user.id,
                          type: "envido",
                        });
                        setShowEnvidoDropdown(false);
                      }
                    }}
                  >
                    Envido
                  </button>
                  <button
                    className={`btn-envido arrow-split-btn ${showEnvidoDropdown ? "active" : ""}`}
                    disabled={!canCallEnvido("real") && !canCallEnvido("falta")}
                    onMouseEnter={() => {
                      if (isTouch) return;
                      setShowEnvidoDropdown(true);
                    }}
                    onClick={() => {
                      soundEffects.playClick();
                      setShowEnvidoDropdown(!showEnvidoDropdown);
                    }}
                  >
                    ▾
                  </button>
                </div>
              </div>

              <button
                className="btn-truco"
                disabled={!canCallTruco()}
                onClick={() => {
                  soundEffects.playClick();
                  socket.emit("callTruco", { gameId: game.id, userId: user.id });
                }}
              >
                {getTrucoLabel()}
              </button>

              <button
                className="btn-fold"
                disabled={game.winner !== null || game.matchWinner !== null}
                onClick={fold}
              >
                Me voy al Mazo
              </button>
            </div>

            {/* RESPONSES */}
            {((game.envido?.pending && game.envido.caller !== user.id) ||
              (!game.envido?.pending &&
                game.truco?.pending &&
                game.truco.caller !== user.id)) && (
              <div className="response">
                <span>
                  {game.envido?.pending
                    ? `${getLastEnvidoCallLabel()}:`
                    : `${getPendingTrucoLabel()}:`}
                </span>

                <button
                  className="btn-yes"
                  onClick={() => {
                    soundEffects.playClick();
                    if (game.envido?.pending) {
                      socket.emit("respondEnvido", {
                        gameId: game.id,
                        userId: user.id,
                        accept: true,
                      });
                    } else {
                      socket.emit("respondTruco", {
                        gameId: game.id,
                        userId: user.id,
                        accept: true,
                      });
                    }
                  }}
                >
                  Quiero
                </button>

                <button
                  className="btn-no"
                  onClick={() => {
                    soundEffects.playClick();
                    if (game.envido?.pending) {
                      socket.emit("respondEnvido", {
                        gameId: game.id,
                        userId: user.id,
                        accept: false,
                      });
                    } else {
                      socket.emit("respondTruco", {
                        gameId: game.id,
                        userId: user.id,
                        accept: false,
                      });
                    }
                  }}
                >
                  No Quiero
                </button>
              </div>
            )}
          </div>

          {/* ===== GAME CONTROLS (NEXT HAND / NEW MATCH) ===== */}
          <div className="result text-center">
            {game.matchWinner ? (
              <>
                <button className="btn-match-nav" onClick={newMatch}>
                  <RefreshCw size={16} style={{ marginRight: 6 }} /> Nueva partida
                </button>
                <button className="btn-match-nav secondary-nav" onClick={() => { soundEffects.playClick(); setGame(null); setScreen("menu"); }}>
                  Volver al Menú
                </button>
              </>
            ) : game.winner ? (
              <>
                <button className="btn-match-nav" onClick={nextHand}>
                  Siguiente mano
                </button>
                <button className="btn-match-nav secondary-nav" onClick={newMatch}>
                  Nueva partida
                </button>
                <button className="btn-match-nav secondary-nav" onClick={() => { soundEffects.playClick(); setGame(null); setScreen("menu"); }}>
                  Volver al Menú
                </button>
              </>
            ) : (
              <button className="btn-match-nav secondary-nav" onClick={() => { soundEffects.playClick(); setGame(null); setScreen("menu"); }}>
                Volver al Menú
              </button>
            )}
          </div>
        </>
      )}

      {/* ===== FLOATING TOAST NOTIFICATION MODAL ===== */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setToast(null)}
          >
            <motion.div
              className={`toast-modal ${toast.type === "success" ? "winner-modal" : "loser-modal"}`}
              initial={{ scale: 0.85, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 30 }}
              transition={{ type: "spring", damping: 20 }}
              onClick={(e) => e.stopPropagation()} // Prevent closing when clicking card body
            >
              <div className="envido-modal-header text-center">
                <span className="toast-modal-icon-emoji">
                  {toast.type === "success" ? "🏆" : "⚠️"}
                </span>
                <h2>{toast.type === "success" ? "¡Éxito!" : "Atención"}</h2>
              </div>
              <div className="envido-modal-body text-center">
                <div className="toast-modal-text">{toast.message}</div>
              </div>
              <div className="envido-modal-footer text-center" style={{ marginTop: "16px" }}>
                <button 
                  className="envido-modal-btn" 
                  onClick={() => {
                    soundEffects.playClick();
                    setToast(null);
                  }}
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
