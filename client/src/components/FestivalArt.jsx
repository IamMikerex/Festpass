import { vibe } from '../lib/vibe';

// Concert photograph for a festival (self-hosted in public/img, chosen by vibe()).
export default function FestivalArt({ id, name, eager }) {
  return <img className="fest-photo" src={vibe({ festival_id: id, name }).photo} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />;
}
