// The schema stores no genre or image, so each festival's sound, photo and accent come from its name.
// shortcut: keyword match on the name; add a `genre` column to Festivals if organizers need to set it.
const GENRES = [
  { re: /beat|techno|rave|bass|electro/i, genre: 'Electronic', photo: 'lasers', accent: '#38bdf8' },
  { re: /sunset|house|beach|sessions/i, genre: 'House', photo: 'sunset', accent: '#fb923c' },
  { re: /rock|metal|punk|guitar/i, genre: 'Rock', photo: 'guitar', accent: '#f43f5e' },
  { re: /wave|indie|aegean/i, genre: 'Indie', photo: 'phones', accent: '#c084fc' },
  { re: /echo|world|folk|jazz|open air/i, genre: 'World', photo: 'openair', accent: '#2dd4bf' },
  { re: /sound|pop/i, genre: 'Pop', photo: 'confetti', accent: '#f472b6' },
];
const SPARE = ['amber', 'sparks', 'haze', 'hands', 'warehouse', 'blue', 'glow'];

export const GENRE_NAMES = [...GENRES.map((g) => g.genre), 'Mixed'];

export function vibe(f = {}) {
  const hit = GENRES.find((g) => g.re.test(f.name || ''));
  const photo = hit ? hit.photo : SPARE[Number(f.festival_id || 0) % SPARE.length];
  return { genre: hit?.genre || 'Mixed', accent: hit?.accent || '#a78bfa', photo: `/img/${photo}.webp` };
}
