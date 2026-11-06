import { Boxes } from 'lucide-react';

// Match model families, never the commercial routing supplier. Unknown models
// keep a neutral mark rather than acquiring an invented vendor identity.
function modelBrand(model: string, kind: 'model' | 'supplier' | 'provider'): [string, string] | null {
  const name = model.toLowerCase();
  if (/^pollo[-_\d]/.test(name)) return ['pollo-official.png', 'Pollo AI'];
  if (/^byteplus/.test(name)) return ['byteplus-official.png', 'BytePlus'];
  if (/^volcengine/.test(name)) return ['volcengine-color', '火山引擎'];
  if (/^aliyun/.test(name)) return ['alibabacloud-color', '阿里云'];
  if (/^google/.test(name)) return ['google-color', 'Google'];
  if (/^openai/.test(name)) return ['openai', 'OpenAI'];
  if (/^elevenlabs/.test(name)) return ['elevenlabs', 'ElevenLabs'];
  if (/^fal(?:$|[-_])/.test(name)) return ['fal-color', 'fal'];
  if (/^replicate/.test(name)) return ['replicate', 'Replicate'];
  if (/^hedra/.test(name)) return ['hedra', 'Hedra'];
  if (/^n8n/.test(name)) return ['n8n-color', 'n8n'];
  if (/^topaz/.test(name)) return ['topazlabs', 'Topaz Labs'];
  if (/^midjourney/.test(name)) return ['midjourney', 'Midjourney'];
  if (/^(xai|grok)/.test(name)) return ['xai', 'xAI'];
  if (/minimax/.test(name)) return ['minimax-color', 'MiniMax'];
  // Supplier routing aliases are distinct from the model they happen to serve.
  // Only infer a model family for model/provider dimensions.
  if (kind === 'supplier') {
    if (/^kling/.test(name)) return ['kling-color', '可灵'];
    if (/^luma/.test(name)) return ['luma-color', 'Luma'];
    if (/^pixverse/.test(name)) return ['pixverse-color', 'PixVerse'];
    if (/^vidu/.test(name)) return ['vidu-color', 'Vidu'];
    if (/^runway/.test(name)) return ['runway', 'Runway'];
    return null;
  }
  if (/^jimeng/.test(name)) return ['bytedance-color', '字节跳动'];
  if (/^(seedance|seedream|doubao)/.test(name)) return ['bytedance-color', '字节跳动'];
  if (/^(wan[-\d]|wan$|qwen)/.test(name)) return ['alibaba-color', '阿里巴巴'];
  if (/^kling/.test(name)) return ['kling-color', '可灵'];
  if (/^(veo|imagen|gemini)/.test(name)) return ['google-color', 'Google'];
  if (/^(sora|gpt|dall)/.test(name)) return ['openai', 'OpenAI'];
  if (/^(minimax|hailuo)/.test(name)) return ['minimax-color', 'MiniMax'];
  if (/^luma/.test(name)) return ['luma-color', 'Luma'];
  if (/^pixverse/.test(name)) return ['pixverse-color', 'PixVerse'];
  if (/^hunyuan/.test(name)) return ['hunyuan-color', '腾讯混元'];
  if (/^vidu/.test(name)) return ['vidu-color', 'Vidu'];
  if (/^(runway|gen-\d)/.test(name)) return ['runway', 'Runway'];
  if (/^flux/.test(name)) return ['flux', 'Black Forest Labs'];
  return null;
}

export function ModelBrand({ model, kind = 'model' }: { model: string; kind?: 'model' | 'supplier' | 'provider' }) {
  const brand = modelBrand(model, kind);
  return brand
    ? <img className="model-brand" src={`/model-brands/${brand[0]}${brand[0].endsWith('.png') ? '' : '.svg'}`} alt={brand[1]} title={brand[1]} width={20} height={20} loading="lazy" decoding="async"/>
    : /unknown|未归因|未知/.test(model)
      ? <Boxes className="model-brand model-brand-unknown" aria-hidden="true" size={20}/>
      : <span className="model-brand model-brand-initial" title={model} aria-label={model}>{model.replace(/[^a-z\d]/gi, '').slice(0, 2).toUpperCase()}</span>;
}
