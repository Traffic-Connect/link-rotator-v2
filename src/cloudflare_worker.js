const TARGET_URLS = [];

const N = TARGET_URLS.length;

addEventListener('fetch', event => {
  event.respondWith(handleRequest());
});

function handleRequest() {
  if (!N) {
    return new Response('No TARGET_URLS configured', { status: 500 });
  }

  const t = Date.now();
  const index = (t >>> 0) % N;
  const target = TARGET_URLS[index];

  return new Response(null, {
    status: 302,
    headers: {
      Location: target
    }
  });
}
