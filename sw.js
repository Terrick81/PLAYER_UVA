const MIME_BY_FOLDER = {
  "0": "image/jpeg",
  "1": "audio/mpeg",
  "2": "video/mp4"
};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Обрабатываем только файлы с этого же сайта.
  if (url.origin !== self.location.origin) return;

  const match = url.pathname.match(/\/content\/([012])\//);
  if (!match) return;

  const mime = MIME_BY_FOLDER[match[1]];

  event.respondWith(
    fetch(request).then((response) => {
      // Не меняем ошибки и ответы, отличные от обычного файла
      // или частичного ответа для Range-запроса.
      if (response.status !== 200 && response.status !== 206) {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.set("Content-Type", mime);

      // Тело и заголовки Range/Content-Range сохраняются.
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    })
  );
});