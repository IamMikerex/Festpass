// Event photography. The database stores no images, so each festival gets a
// photo picked deterministically from this list, with generated poster art
// underneath as a fallback (offline, blocked host, or a photo that fails).
// Swap these for your own festival photography or a CDN.
// Set VITE_REMOTE_PHOTOS=false to use only the generated artwork.
const UNSPLASH = (id, w) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

const FESTIVAL_PHOTOS = [
  'photo-1470229722913-7c0e2dbbafd3', // crowd under stage lights
  'photo-1501281668745-f7f57925c3b4', // open-air festival at sunset
  'photo-1492684223066-81342ee5ff30', // confetti over the crowd
  'photo-1514525253161-7a46d19cd819', // laser show
  'photo-1533174072545-7a4b6ad7a6c3', // festival crowd, hands up
  'photo-1506157786151-b8491531f063', // festival main stage
  'photo-1540039155733-5bb30b53aa14', // concert crowd
  'photo-1459749411175-04bf5292ceea', // band on stage
];

export const SCENES = {
  stage: 'photo-1429962714451-bb934ecdc4ec',
  dj: 'photo-1516450360452-9312f5e86fc7',
  food: 'photo-1555939594-58d7cb561ad1',
  camping: 'photo-1504280390367-361c6d9f38f4',
  crowd: 'photo-1493225457124-a3eb161ffa5f',
};

export const remotePhotos = import.meta.env.VITE_REMOTE_PHOTOS !== 'false';

export function festivalPhoto(id, w = 1200) {
  if (!remotePhotos) return null;
  const list = FESTIVAL_PHOTOS;
  return UNSPLASH(list[Math.abs(Number(id) || 0) % list.length], w);
}

export function scenePhoto(key, w = 900) {
  if (!remotePhotos || !SCENES[key]) return null;
  return UNSPLASH(SCENES[key], w);
}
