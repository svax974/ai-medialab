// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Explanations shown in the "?" tooltips. Generic text per parameter key lives here; a model's own
// `ParamSpec.help` (from the backend, so custom models get one too) is added on top as "Ce modèle :".
import type { ModelKind, ParamSpec, VideoCaps } from "./api";
import type { Help } from "../components/ui";

const GENERIC: Record<string, Help> = {
  steps: {
    title: "Étapes",
    body: "Nombre de passes de calcul pour faire émerger le résultat à partir de bruit. Plus d'étapes = plus de finesse et de cohérence, mais un temps de calcul proportionnel ; au-delà d'un certain seuil, le gain devient invisible.",
    tip: "gardez la valeur par défaut ; baissez-la pour un brouillon rapide. Un modèle « distillé » ou « turbo » n'a besoin que de 4 à 9 étapes.",
  },
  guidance: {
    title: "Guidance (CFG)",
    body: "Force avec laquelle le modèle doit coller à votre prompt. Bas : plus libre et naturel, parfois approximatif. Haut : plus fidèle, mais images trop contrastées ou « brûlées » si on exagère. À 1, la guidance est désactivée (ce qui accélère le calcul, car le modèle ne calcule qu'une passe au lieu de deux).",
    tip: "restez près de la valeur par défaut ; changez-la d'un demi-point à la fois.",
  },
  negative_prompt: {
    title: "Prompt négatif",
    body: "Ce que le résultat doit éviter : « flou, texte, doigts en trop, filigrane »… Décrivez des défauts ou éléments, pas des phrases (« sans X » fonctionne mal dans le prompt principal).",
    tip: "laissez vide si tout va bien. Sur un modèle sans guidance (1 = désactivé), il n'a aucun effet.",
  },
  strength: {
    title: "Influence",
    body: "Dosage entre l'image de départ et votre prompt lorsqu'on part d'une image existante : d'un côté le résultat reste proche de l'original, de l'autre le modèle s'en éloigne pour suivre le texte. Le sens exact dépend du modèle (voir ci-dessous).",
    tip: "essayez 2 ou 3 valeurs avec la même graine pour trouver le bon dosage.",
  },
  seed: {
    title: "Graine (seed)",
    body: "Nombre qui détermine le bruit de départ. Laissée vide, une graine aléatoire est tirée à chaque génération : chaque essai donne un résultat différent. Fixée, le même prompt avec les mêmes réglages redonne exactement le même résultat. « Varier » et « Refaire » tirent de nouvelles graines ; le bouton ↻ « mêmes graines » les réutilise.",
    tip: "fixez la graine d'un résultat qui vous plaît, puis ne changez qu'un réglage à la fois pour voir son effet.",
  },
  speed: {
    title: "Vitesse de parole",
    body: "Rythme de lecture. 1 = vitesse naturelle ; en dessous la voix ralentit, au-dessus elle accélère. Les valeurs extrêmes (< 0,8 ou > 1,25) peuvent sonner moins naturel.",
  },
  temperature: {
    title: "Variabilité",
    body: "Part de hasard dans l'intonation. Bas : voix régulière et prévisible. Haut : plus expressive et variée, mais moins stable (hésitations, accents qui dérivent).",
    tip: "0,9 convient à la plupart des textes ; baissez-la pour un long texte à lire de façon uniforme.",
  },
  fast_decode: {
    title: "Décodage rapide",
    body: "Utilise un petit décodeur léger (TAEHV) pour transformer le résultat final en images. Le décodage tombe de plusieurs minutes à moins d'une seconde, surtout sur Mac. En contrepartie, les détails fins sont un peu moins nets.",
    tip: "gardez-le activé pour explorer ; désactivez-le pour le rendu final si vous voyez des détails écrasés.",
  },
  count_images: {
    title: "Nombre d'images",
    body: "Combien de variantes générer pour ce prompt, chacune avec sa propre graine. Elles sont calculées l'une après l'autre : 4 images prennent environ 4 fois plus de temps qu'une.",
  },
  count_takes: {
    title: "Nombre de prises",
    body: "Combien de lectures générer pour le même texte, chacune avec une graine différente : l'intonation et le rythme varient d'une prise à l'autre. Elles sont calculées l'une après l'autre.",
    tip: "faites 2 ou 3 prises, puis gardez la meilleure : la même voix ne dit jamais tout à fait pareil deux fois.",
  },
  count_clips: {
    title: "Nombre de clips",
    body: "Combien de vidéos générer pour ce prompt (graines différentes). Une vidéo prend du temps et de la mémoire : chaque clip est calculé l'un après l'autre, donc 2 clips = 2 fois plus d'attente.",
  },
};

export const HELP: Record<string, Help> = {
  ...GENERIC,

  // --- Image ---
  aspect: {
    title: "Format (rapport largeur/hauteur)",
    body: "Forme de l'image : 1:1 carré, 4:5 ou 3:4 portrait, 16:9 paysage large… « Auto » reprend le format de l'image de référence. « Libre » permet de saisir la largeur et la hauteur en pixels.",
    tip: "choisissez le format avant de générer : recadrer après coup coûte du cadrage.",
  },
  megapixels: {
    title: "Définition",
    body: "Nombre total de pixels de l'image, en mégapixels (MP). Plus haut = plus de détails et d'images plus grandes, mais un calcul et une mémoire qui augmentent vite (2 MP ≈ 2 fois plus lent que 1 MP). Au-delà de la taille pour laquelle le modèle a été entraîné (~1 à 1,6 MP), les compositions peuvent se dédoubler.",
    tip: "cherchez la composition en « Brouillon » ou « Standard », puis refaites en « Haute » avec la graine qui vous plaît.",
  },
  size_custom: {
    title: "Taille libre",
    body: "Largeur et hauteur exactes en pixels. Le modèle travaille par multiples fixes (16, 32 ou 64 px selon le modèle) : les valeurs sont arrondies, et bornées entre un minimum et un maximum par côté.",
    tip: "évitez les très grandes tailles : préférez générer à ~1 MP puis agrandir.",
  },
  reference_images: {
    title: "Images de référence",
    body: "Selon le modèle :\n• image de départ (img2img) : le modèle transforme une seule image, la 1re ;\n• édition multi-images : il lit plusieurs images (« image 1 », « image 2 »…) pour les modifier ou les combiner ;\n• aucun usage : les images sont « ignorées » (grisées) et n'ont aucun effet.\nLes images en trop, au-delà de ce que le modèle accepte, sont aussi « ignorées ».",
    tip: "dans le prompt, désignez les images par leur numéro : « le personnage de l'image 1 dans le décor de l'image 2 ».",
  },

  // --- Audio ---
  language: {
    title: "Langue du texte",
    body: "Langue dans laquelle le texte est écrit. Elle règle la prononciation et filtre les voix proposées (une voix est taillée pour sa langue). Un texte dans une autre langue que celle choisie sera lu avec un fort accent, voire de travers.",
  },
  voice: {
    title: "Voix",
    body: "Trois origines possibles :\n• voix du modèle : voix intégrées, prêtes à l'emploi ;\n• voix clonée : reproduite à partir d'un extrait audio de quelques secondes, dans « Mes voix » ;\n• voix décrite : inventée à partir d'une description écrite, quand le modèle le permet.",
    tip: "pour cloner une voix, utilisez un extrait propre de 10 à 30 s et ne clonez que votre voix ou celle d'une personne consentante.",
  },
  instruct: {
    title: "Style",
    body: "Consigne en langage naturel qui guide la manière de dire le texte : ton, émotion, débit, ambiance (« chuchoté », « voix chaleureuse et posée, débit lent », « enthousiaste »). Elle ne change pas les mots prononcés.",
    tip: "décrivez une seule intention claire, en peu de mots ; quelques mots valent mieux qu'un long paragraphe.",
  },
  instruct_design: {
    title: "Description de la voix",
    body: "Ce modèle n'a pas de voix toute faite : il invente la voix d'après votre description (âge, sexe, timbre, ton, accent, débit). Elle est obligatoire. Le résultat varie d'une prise à l'autre, un peu comme un casting.",
    tip: "exemple : « femme de 30 ans, voix grave et posée, accent du sud, débit lent ». Gardez la même description et la même graine pour retrouver une voix.",
  },
  script: {
    title: "Dialogue à plusieurs voix",
    body: "Écrivez chaque réplique en début de ligne, sous la forme « Nom : texte » (par exemple « Alice : Bonjour ! » puis « Marc : Salut. »). Dès qu'au moins deux noms sont détectés, vous pouvez attribuer une voix à chaque personnage (attribuées automatiquement par défaut, avec des voix différentes). Le nom n'est pas lu. Une ligne sans nom prolonge la réplique précédente, et une ligne vide ajoute une pause.",
    tip: "utilisez toujours exactement le même nom pour un même personnage.",
  },
  clone_sample: {
    title: "Extrait de référence",
    body: "Court enregistrement de la voix à imiter. Le modèle en reprend le timbre, mais aussi le ton, le rythme et l'ambiance du micro. Seules les 30 premières secondes sont utilisées.",
    tip: "10 à 30 s, une seule voix, sans musique, sans écho ni bruit de fond.",
  },
  transcript: {
    title: "Transcription de l'extrait",
    body: "Texte exact prononcé dans l'extrait. Facultatif, mais il aide le modèle à mieux « entendre » la voix et améliore nettement la fidélité du clonage avec Qwen3. Elle doit correspondre mot pour mot à ce qui est dit, sinon elle dégrade le résultat.",
    tip: "« Transcrire automatiquement » propose un texte ; relisez-le et corrigez-le toujours si besoin.",
  },
  max_chars: {
    title: "Longueur du texte",
    body: "Un modèle ne lit bien qu'un passage court à la fois. Au-delà de sa limite, le texte est coupé automatiquement en morceaux (aux phrases) lus l'un après l'autre, puis recollés : la synthèse est plus longue, et le ton peut légèrement varier d'un morceau à l'autre.",
    tip: "pour un long texte, comptez plusieurs minutes de calcul.",
  },
  autoplay: {
    title: "Lecture automatique",
    body: "Lance l'écoute dès que la synthèse est terminée.",
  },

  // --- Video ---
  seconds: {
    title: "Durée du clip",
    body: "Durée de la vidéo. Le modèle calcule un nombre d'images par paliers (n × pas + 1) : la durée affichée est arrondie à la valeur réelle la plus proche. Plus le clip est long, plus la mémoire et le temps explosent : doubler la durée fait plus que doubler l'attente, et la cohérence du mouvement s'affaiblit.",
    tip: "commencez par des clips courts (2 à 4 s) pour valider l'idée.",
  },
  video_aspect: {
    title: "Format",
    body: "Forme de la vidéo : 16:9 paysage, 9:16 vertical, 1:1 carré… Le nombre de pixels reste proche de la définition choisie ; seule la forme change.",
  },
  resolution: {
    title: "Définition",
    body: "Taille de l'image en pixels (480p, 720p…). C'est le réglage qui coûte le plus : 720p demande ~2,25 fois plus de calcul que 480p. Les modèles sont entraînés à certaines tailles natives ; en dessous, la qualité s'effondre (surtout avec Wan), et au-dessus la cohérence peut se dégrader.",
    tip: "validez en 480p, puis refaites en 720p avec la même graine si le résultat vous plaît.",
  },
  slot_start: {
    title: "Image de départ",
    body: "La vidéo démarre de cette image (image → vidéo) : le modèle l'anime en suivant votre prompt, qui doit décrire le mouvement plutôt que l'image. Selon le modèle, elle est requise, facultative ou ignorée. Pour certains modèles, c'est une simple image de « référence » qui inspire le sujet sans être la 1re image.",
    tip: "choisissez une image dont le format est proche de celui de la vidéo.",
  },
  slot_end: {
    title: "Image de fin",
    body: "La vidéo se termine sur cette image : le modèle invente la transition entre l'image de départ et celle-ci (« première/dernière image »). Elle exige l'image de départ, et n'existe que sur certains modèles.",
  },
  slot_source: {
    title: "Vidéo source",
    body: "Vidéo existante que le modèle modifie selon votre prompt (changer l'ambiance, un objet, le style…) tout en gardant son mouvement. Réservée aux modèles de montage.",
    tip: "le réglage « Influence de la vidéo » dose la part de transformation.",
  },
  strength_video: {
    title: "Influence de la vidéo",
    body: "Part de transformation appliquée à la vidéo source. Bas : le résultat reste proche de l'original. Haut : le modèle suit davantage votre prompt, au prix de s'éloigner de la vidéo.",
    tip: "0,6 à 0,8 pour un changement de style ; plus bas pour une retouche légère.",
  },
  english_only: {
    title: "Prompt en anglais",
    body: "Ce modèle a surtout été entraîné sur des descriptions en anglais : un prompt en français est souvent mal compris. Rédigez ou faites traduire votre prompt avant de générer.",
  },
  audio_out: {
    title: "Bande son",
    body: "Ce modèle génère aussi un son synchronisé avec l'image (ambiance, bruitages, parfois paroles). Décrivez ce qu'on doit entendre dans le prompt pour l'orienter.",
  },
  license: {
    title: "Licence",
    body: "Ce modèle impose des restrictions d'usage. Vérifiez qu'elles s'appliquent à votre situation avant de générer ou de publier des vidéos.",
  },

  // --- Models and settings ---
  quantize: {
    title: "Précision des poids",
    body: "Les poids d'un modèle peuvent être « compressés » pour tenir en mémoire :\n• bf16 : pleine précision, qualité maximale, taille et mémoire maximales ;\n• 8 bits : environ moitié moins lourd, qualité quasi identique ;\n• 6 bits : un bon compromis ;\n• 4 bits : environ 4 fois plus léger, très légère perte de finesse, le plus rapide à charger.",
    tip: "4 ou 6 bits suffisent presque toujours ; passez à bf16 si votre mémoire le permet et que vous cherchez le maximum de détails.",
  },
  variant: {
    title: "Quantification",
    body: "Version plus ou moins compressée du même modèle. Les formats GGUF (Q4_K_M, Q5_K_M, Q8_0…) indiquent le nombre de bits par poids : Q4 ≈ 4 bits (léger, légère perte), Q5/Q6 (compromis), Q8 ≈ 8 bits (quasi sans perte, deux fois plus lourd que Q4), bf16/f16 (aucune compression, le plus lourd). « K_M » désigne une compression plus fine qui préserve mieux les couches sensibles. Une seule version est téléchargée à la fois.",
    tip: "à mémoire limitée, prenez Q4_K_M ; dès que la machine le permet, Q8_0 donne un résultat plus fidèle.",
  },
  keep_alive: {
    title: "Durée en mémoire",
    body: "Après une génération, le modèle reste chargé en mémoire pendant ce délai : la suivante démarre aussitôt. « Aussitôt » libère la mémoire tout de suite (utile si vous utilisez d'autres applications gourmandes) ; « Jamais » ne décharge pas le modèle automatiquement. Recharger un gros modèle depuis le disque prend de quelques secondes à une minute.",
  },
  previews: {
    title: "Aperçus",
    body: "Pendant le calcul, décode quelques images intermédiaires pour voir l'image se former. Pratique pour interrompre une génération mal partie, mais ces aperçus coûtent un peu de temps et de mémoire.",
  },
  low_memory: {
    title: "Économie de mémoire",
    body: "Libère l'encodeur de texte (le plus gros composant) dès que le prompt est lu. La mémoire nécessaire est nettement plus basse, et on évite le « swap » (saturation de la mémoire qui ralentit tout, voire fait expirer le GPU). Contrepartie : un nouveau prompt recharge l'encodeur depuis le disque, quelques secondes.",
    tip: "activez-le si la mémoire de la machine est juste.",
  },
};

const REPEATS = ["Plus d'étapes = plus de détails, plus lent.", "Ce que l'image doit éviter.", "Ce que la vidéo doit éviter.", "Fidélité au prompt."];

/** Tooltip for a model parameter: the generic explanation plus the model's own caveat. */
export function paramHelp(spec: ParamSpec, kind: ModelKind): Help {
  const generic = HELP[spec.key === "strength" && kind === "video" ? "strength_video" : spec.key];
  const raw = spec.help?.trim();
  // Skip help that only repeats the generic explanation.
  const specific = raw && !REPEATS.some((r) => raw.startsWith(r)) ? raw : "";
  if (!generic) return { title: spec.label, body: specific || spec.label };
  const body = specific ? (
    `${generic.body}\n\nCe modèle : ${specific}`
  ) : generic.body;
  return { ...generic, body };
}

/** Why a start image / end image / source video slot exists for this video model. */
export function slotHelp(slot: "start" | "end" | "source", caps: VideoCaps): Help {
  const base = HELP[`slot_${slot}`];
  const status =
    slot === "start"
      ? caps.image_input === "required" ? "Requise pour ce modèle." : caps.image_input === "optional" ? "Facultative pour ce modèle : sans elle, la vidéo part de votre texte seul." : "Ce modèle ne l'utilise pas."
      : slot === "end"
        ? caps.last_frame ? "Facultative pour ce modèle (avec l'image de départ)." : "Ce modèle ne l'utilise pas."
        : caps.video_input === "required" ? "Requise : ce modèle ne fait que du montage." : caps.video_input === "optional" ? "Facultative pour ce modèle." : "Ce modèle ne sait pas monter une vidéo.";
  const role = slot === "start" && caps.image_role === "reference" ? " Ici elle sert de référence (sujet, style), pas de première image." : "";
  return { ...base, body: `${base.body}\n\n${status}${role}` };
}
