"use strict";

const $ = (selector) => document.querySelector(selector);

const audio = $("#audio");
const video = $("#video");
const miniPlayer = $("#mini-player");
const playerScreen = $("#player-screen");

let playlist = null;
let currentTrack = null;
let playQueue = [];
let queueIndex = -1;
let shuffleEnabled = false;
let switchingTrack = false;
let trackLoadId = 0;

const icons = {
  play: `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor"
        d="M6 4.9c0-.7.8-1.1 1.4-.7l9 5.1a.8.8 0 0 1 0 1.4l-9 5.1c-.6.4-1.4 0-1.4-.7V4.9Z"></path>
    </svg>`,
  pause: `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor"
        d="M8.25 3.09v13.82a.415.415 0 0 1-.417.416H4.81a.415.415 0 0 1-.417-.416V3.09a.415.415 0 0 1 .417-.416h3.023a.415.415 0 0 1 .416.416m7.358 0v13.82a.415.415 0 0 1-.417.416h-3.022a.416.416 0 0 1-.417-.416V3.09a.415.415 0 0 1 .417-.416h3.022a.415.415 0 0 1 .417.416"></path>
    </svg>`,
  previous: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor"
        d="M12.798 4.025a.33.33 0 0 0-.342.016L7.503 7.332V4.318a.33.33 0 0 0-.176-.293.33.33 0 0 0-.342.016l-5.54 3.681a.33.33 0 0 0-.15.278c0 .106.05.212.15.278l5.54 3.681c.11.074.24.071.342.016a.33.33 0 0 0 .176-.293V8.668l4.953 3.291c.11.074.24.071.341.016a.33.33 0 0 0 .176-.293V4.318a.33.33 0 0 0-.176-.293"></path>
    </svg>`,
  next: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor"
        d="M3.202 4.025a.33.33 0 0 1 .342.016l4.953 3.291V4.318a.33.33 0 0 1 .176-.293.33.33 0 0 1 .342.016l5.54 3.681a.33.33 0 0 1 .15.278c0 .106-.05.212-.15.278l-5.54 3.681a.33.33 0 0 1-.342.016.33.33 0 0 1-.176-.293V8.668l-4.953 3.291a.33.33 0 0 1-.341.016.33.33 0 0 1-.176-.293V4.318a.33.33 0 0 1 .176-.293"></path>
    </svg>`,
  shuffle: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"
        stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  download: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
        stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  close: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6.5 9 5.5 5.5L17.5 9"
        stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`
};

function setIcon(selector, icon) {
  const element = $(selector);
  if (element) element.innerHTML = icon;
}

setIcon("#mini-play", icons.play);
setIcon("#full-play", icons.play);
setIcon("#previous-track", icons.previous);
setIcon("#full-previous", icons.previous);
setIcon("#next-track", icons.next);
setIcon("#full-next", icons.next);
setIcon("#mini-shuffle", icons.shuffle);
setIcon("#full-shuffle", icons.shuffle);
setIcon("#download-track", icons.download);
setIcon("#close-player", icons.close);

/*
 * Регистрируем Service Worker до загрузки плейлиста.
 * Он нужен, чтобы браузер получил правильные MIME-типы для .bin.
 */
async function prepareServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    console.warn("Service Worker недоступен: нужен HTTPS или localhost.");
    return;
  }

  try {
    const swUrl = new URL("./sw.js", document.baseURI);
    const scopeUrl = new URL("./", document.baseURI);

    await navigator.serviceWorker.register(swUrl, {
      scope: scopeUrl.pathname
    });

    await navigator.serviceWorker.ready;

    // При первой установке ждём, пока активный SW возьмёт страницу под контроль.
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            resolve,
            { once: true }
          );
        }),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
    }
  } catch (error) {
    console.error("Не удалось подготовить Service Worker:", error);
  }
}

function resolvePath(path) {
  if (!path) return "";

  // Пути в JSON должны быть вида content/0/00.bin, со слэшами `/`.
  return new URL(path, document.baseURI).href;
}

function setImage(img, path) {
  if (!img) return;

  if (!path) {
    img.removeAttribute("src");
    return;
  }

  const requestId = (Number(img.dataset.requestId) || 0) + 1;
  img.dataset.requestId = String(requestId);

  img.onerror = () => {
    if (img.dataset.requestId !== String(requestId)) return;
    console.warn("Не удалось загрузить изображение:", path);
    img.removeAttribute("src");
  };

  img.src = resolvePath(path);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function parseDuration(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) return null;

  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function displayDuration(value) {
  if (typeof value === "string" && value.trim()) return value.trim();

  const seconds = parseDuration(value);
  return seconds === null ? "--:--" : formatTime(seconds);
}

function getDurationSeconds() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }

  return parseDuration(currentTrack?.duration);
}

function updateTimeline(input, current, duration) {
  if (!input) return;

  const percent = duration > 0
    ? Math.max(0, Math.min(100, current / duration * 100))
    : 0;

  input.value = String(Math.round(percent * 10));
  input.style.setProperty("--progress", `${percent}%`);
}

function setPlayButtons(playing) {
  const icon = playing ? icons.pause : icons.play;

  for (const selector of ["#mini-play", "#full-play"]) {
    const button = $(selector);
    if (!button) continue;

    button.innerHTML = icon;
    button.setAttribute("aria-label", playing ? "Пауза" : "Воспроизвести");
  }

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
}

function shuffleTracks(tracks) {
  const result = [...tracks];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function updateShuffleButtons() {
  for (const button of [$("#mini-shuffle"), $("#full-shuffle")]) {
    if (!button) continue;

    button.classList.toggle("active", shuffleEnabled);
    button.setAttribute("aria-pressed", String(shuffleEnabled));
    button.setAttribute(
      "aria-label",
      shuffleEnabled ? "Выключить перемешивание" : "Перемешать треки"
    );
    button.title = shuffleEnabled
      ? "Выключить перемешивание"
      : "Перемешать треки";
  }
}

function setQueueForTrack(track) {
  if (!playlist?.tracks?.length) return;

  if (shuffleEnabled) {
    playQueue = [
      track,
      ...shuffleTracks(playlist.tracks.filter((item) => item !== track))
    ];
    queueIndex = 0;
  } else {
    playQueue = [...playlist.tracks];
    queueIndex = playQueue.indexOf(track);
  }
}

function setMediaAction(action, handler) {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Действие может не поддерживаться браузером.
  }
}

function updateMediaPosition() {
  if (!("mediaSession" in navigator)) return;

  const duration = getDurationSeconds();
  if (!Number.isFinite(duration) || duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime || 0, duration)
    });
  } catch {
    // Поддержка позиции зависит от браузера.
  }
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || !track) return;

  const imagePath = track.cover;
  const artwork = imagePath
    ? [{ src: resolvePath(imagePath), sizes: "512x512" }]
    : [];

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Без названия",
      album: "МУЗЫКАЛЬНОЕ КАФЕ СВА",
      artwork
    });
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  } catch (error) {
    console.warn("Не удалось обновить данные экрана блокировки:", error);
  }

  setMediaAction("play", () => audio.play().catch(() => {}));
  setMediaAction("pause", () => audio.pause());
  setMediaAction("previoustrack", () => changeTrack(-1));
  setMediaAction("nexttrack", () => changeTrack(1));
  setMediaAction("seekto", (details) => {
    if (Number.isFinite(details.seekTime)) {
      audio.currentTime = details.seekTime;
    }
  });

  updateMediaPosition();
}

function renderPlaylist(data) {
  if (!data || !Array.isArray(data.tracks)) {
    throw new Error("В playlist.json не найден массив tracks.");
  }
  playlist = data;
  const groups = new Map();
  for (const track of data.tracks) {
    const year = track.year ? String(track.year) : "Без года";
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(track);
  }

  const years = [...groups.keys()].sort((a, b) => {
    if (a === "Без года") return 1;
    if (b === "Без года") return -1;
    return Number(b) - Number(a);
  });

  const list = $("#track-list");
  list.replaceChildren();

  for (const year of years) {
    const heading = document.createElement("h2");
    heading.className = "year-heading";
    heading.textContent = year;
    list.append(heading);

    for (const track of groups.get(year)) {
      const row = document.createElement("button");
      row.className = "track";
      row.type = "button";

      const image = document.createElement("img");
      image.className = "track-cover";
      image.alt = "";
      setImage(image, track.cover || data.cover);

      const info = document.createElement("span");
      info.className = "track-info";

      const title = document.createElement("span");
      title.className = "track-title";
      title.textContent = track.title || "Без названия";

      const duration = document.createElement("span");
      duration.className = "track-duration";
      duration.textContent = displayDuration(track.duration);

      info.append(title);
      row.append(image, info, duration);
      row.addEventListener("click", () => selectTrack(track));
      list.append(row);
    }
  }

  $("#message").textContent = data.tracks.length
    ? ""
    : "В плейлисте пока нет треков.";
}

function setDownloadLink(track) {
  const link = $("#download-track");
  if (!link) return;

  if (!track?.audio) {
    link.removeAttribute("href");
    link.removeAttribute("download");
    link.setAttribute("aria-disabled", "true");
    return;
  }

  const safeTitle = (track.title || "audio")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .trim() || "audio";

  link.href = resolvePath(track.audio);
  link.download = `${safeTitle}.mp3`;
  link.setAttribute("aria-disabled", "false");
}

async function selectTrack(track, fromQueue = false) {
  if (!track?.audio) {
    $("#message").textContent = "У этого трека не указан путь к аудиофайлу.";
    return;
  }

  const requestId = ++trackLoadId;

  switchingTrack = true;
  currentTrack = track;

  if (!fromQueue) setQueueForTrack(track);

  audio.pause();
  video.pause();

  audio.removeAttribute("src");
  audio.load();

  video.removeAttribute("src");
  video.load();

  const clipSection = $("#clip-section");
  clipSection.hidden = !track.video;

  $("#video-wrap").classList.remove("visible");
  miniPlayer.hidden = false;

  const title = track.title || "Без названия";
  const coverPath = track.cover;

  $("#mini-title").textContent = title;
  $("#full-title").textContent = title;

  setImage($("#mini-cover"), coverPath);
  setImage($("#big-cover"), coverPath);

  $("#mini-time").textContent =
    `0:00 / ${displayDuration(track.duration)}`;
  $("#full-current-time").textContent = "0:00";
  $("#full-duration").textContent = displayDuration(track.duration);

  updateTimeline($("#mini-progress"), 0, parseDuration(track.duration) || 0);
  updateTimeline($("#full-progress"), 0, parseDuration(track.duration) || 0);

  setDownloadLink(track);
  updateMediaSession(track);
  setPlayButtons(false);

  /*
   * ВАЖНО: используем URL .bin напрямую.
   * Service Worker должен вернуть для content/1/ тип audio/mpeg,
   * а для content/2/ — video/mp4.
   */
  audio.src = resolvePath(track.audio);
  audio.load();

  if (track.video) {
    video.src = resolvePath(track.video);
    video.load();
  }

  try {
    await audio.play();

    if (requestId === trackLoadId) {
      switchingTrack = false;
      setPlayButtons(true);
      updateMediaSession(track);
    }
  } catch (error) {
    if (requestId === trackLoadId) {
      switchingTrack = false;
      setPlayButtons(false);
      $("#message").textContent =
        "Не удалось запустить аудио. Проверьте путь к файлу и Service Worker.";
    }

    console.error("Ошибка воспроизведения аудио:", error);
  }
}

function changeTrack(direction) {
  if (!playQueue.length) return;

  let nextIndex = queueIndex + direction;

  if (nextIndex < 0) nextIndex = playQueue.length - 1;
  if (nextIndex >= playQueue.length) nextIndex = 0;

  queueIndex = nextIndex;
  selectTrack(playQueue[queueIndex], true);
}

function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;
  updateShuffleButtons();

  if (currentTrack) {
    setQueueForTrack(currentTrack);
  }
}

function togglePlayback() {
  if (!currentTrack) {
    const firstTrack = playlist?.tracks?.[0];
    if (firstTrack) selectTrack(firstTrack);
    return;
  }

  if (audio.paused) {
    audio.play().catch((error) => {
      console.warn("Не удалось запустить аудио:", error);
    });
  } else {
    audio.pause();
  }
}

function openPlayer() {
  playerScreen.classList.add("open");
  playerScreen.setAttribute("aria-hidden", "false");
  document.body.classList.add("player-open");
}

function closePlayer() {
  playerScreen.classList.remove("open");
  playerScreen.setAttribute("aria-hidden", "true");
  document.body.classList.remove("player-open");
}

function seekFromTimeline(input) {
  const duration = getDurationSeconds();
  if (!Number.isFinite(duration) || duration <= 0) return;

  const fraction = Number(input.value) / 1000;
  audio.currentTime = fraction * duration;

  // Если пользователь перематывает аудио, двигаем видео к той же позиции.
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = Math.min(fraction * video.duration, video.duration);
  }
}

$("#mini-play").addEventListener("click", togglePlayback);
$("#full-play").addEventListener("click", togglePlayback);

$("#previous-track").addEventListener("click", () => changeTrack(-1));
$("#full-previous").addEventListener("click", () => changeTrack(-1));
$("#next-track").addEventListener("click", () => changeTrack(1));
$("#full-next").addEventListener("click", () => changeTrack(1));

$("#mini-shuffle").addEventListener("click", toggleShuffle);
$("#full-shuffle").addEventListener("click", toggleShuffle);

miniPlayer.addEventListener("click", (event) => {
  if (event.target.closest("button, input, a")) return;
  openPlayer();
});

$("#close-player").addEventListener("click", closePlayer);

$("#mini-progress").addEventListener("input", (event) => {
  seekFromTimeline(event.currentTarget);
});
$("#full-progress").addEventListener("input", (event) => {
  seekFromTimeline(event.currentTarget);
});

audio.addEventListener("play", () => {
  setPlayButtons(true);
  video.pause();
});

audio.addEventListener("pause", () => {
  if (!switchingTrack) setPlayButtons(false);
});

audio.addEventListener("timeupdate", () => {
  const duration = getDurationSeconds();
  const current = audio.currentTime || 0;

  $("#mini-time").textContent =
    `${formatTime(current)} / ${displayDuration(duration)}`;
  $("#full-current-time").textContent = formatTime(current);
  $("#full-duration").textContent = displayDuration(duration);

  updateTimeline($("#mini-progress"), current, duration || 0);
  updateTimeline($("#full-progress"), current, duration || 0);
  updateMediaPosition();
});

audio.addEventListener("loadedmetadata", () => {
  const duration = getDurationSeconds();
  if (duration) {
    $("#full-duration").textContent = displayDuration(duration);
  }
});

audio.addEventListener("ended", () => {
  if (playQueue.length > 1) changeTrack(1);
  else setPlayButtons(false);
});

audio.addEventListener("error", () => {
  if (!currentTrack) return;

  $("#message").textContent =
    "Не удалось загрузить аудио. Проверьте имя файла, Service Worker и MIME-тип.";
  console.error("Ошибка загрузки аудио:", audio.error);
});

video.addEventListener("play", () => {
  audio.pause();
  $("#video-wrap").classList.add("visible");
});

video.addEventListener("error", () => {
  if (!currentTrack?.video) return;

  console.error("Ошибка загрузки видео:", video.error);
  $("#message").textContent =
    "Не удалось загрузить клип. Проверьте путь и MIME-тип video/mp4.";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePlayer();
});

async function start() {
  $("#message").textContent = "Загрузка…";

  await prepareServiceWorker();

  try {
    const data = await loadEncryptedPlaylist();
    renderPlaylist(data);
  } catch (error) {
    console.error("Не удалось загрузить плейлист:", error);

    $("#message").textContent =
      error.message === "Вход отменён."
        ? "Для просмотра плейлиста нужен код доступа."
        : "Не удалось открыть плейлист. Проверьте код доступа и наличие playlist.enc.";
  }
}

updateShuffleButtons();
start();