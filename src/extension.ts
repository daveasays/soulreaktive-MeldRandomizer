import {
  initialize,
  type ActivationContext,
  type Handle,
  MidiTrack,
  Device,
  DeviceParameter,
} from "@ableton-extensions/sdk";

import dialInterface from "./dial.html";

const EXCLUDED_PARAMS = new Set([
  "Device On",
  "Volume",
  "A Volume",
  "B Volume",
  "A Transpose",
  "A Transp Scale",
  "A Octave",
  "B Transpose",
  "B Transp Scale",
  "B Octave",
  "Mono Poly",       // verrouillé en Poly
  "Limiter On",      // verrouillé à ON
  "A Keytracking",   // verrouillé à ON
  "B Keytracking",   // verrouillé à ON
]);

const ENGINE_ON_PARAMS = ["A On", "B On"];
const FILTER_ON_PARAMS = ["A Filter On", "B Filter On"];

// -10dB = 0.5623, -20dB = 0.3162 — cible -12dB ≈ 0.50
const VOLUME_MAX = 0.50;

function randomizeParam(param: DeviceParameter<"1.0.0">, intensity: number): number {
  const range = param.max - param.min;
  if (param.isQuantized) {
    const items = param.valueItems;
    const count = items.length > 0 ? items.length : Math.round(range) + 1;
    const randomIndex = Math.floor(Math.random() * count);
    return param.min + randomIndex;
  }
  const center = (param.min + param.max) / 2;
  const targetRandom = param.min + Math.random() * range;
  return center + (targetRandom - center) * intensity;
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("meld.randomize", async (arg: unknown) => {
    const handle = arg as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    const meldDevices = track.devices.filter((d: Device<"1.0.0">) => {
      const names = new Set(d.parameters.map((p: DeviceParameter<"1.0.0">) => p.name));
      return names.has("A On") && names.has("B On") && names.has("Engine B Delay");
    });

    if (meldDevices.length === 0) {
      console.log(`[Meld Randomizer] Aucun Meld sur "${track.name}".`);
      return;
    }

    let result: string;
    try {
      result = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(dialInterface)}`,
        320,
        340
      );
    } catch {
      console.log("[Meld Randomizer] Annulé.");
      return;
    }

    const parsed = JSON.parse(result) as { intensity: number | null };
    if (parsed.intensity === null) {
      console.log("[Meld Randomizer] Annulé.");
      return;
    }

    const intensity = parsed.intensity;

    for (const device of meldDevices) {
      const allParams = device.parameters;

      const engineOnParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => ENGINE_ON_PARAMS.includes(p.name)
      );
      const filterOnParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => FILTER_ON_PARAMS.includes(p.name)
      );
      const volumeParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => ["Volume", "A Volume", "B Volume"].includes(p.name)
      );
      const limiterParam = allParams.find(
        (p: DeviceParameter<"1.0.0">) => p.name === "Limiter On"
      );
      const monoPoly = allParams.find(
        (p: DeviceParameter<"1.0.0">) => p.name === "Mono Poly"
      );
      const randomizableParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) =>
          !EXCLUDED_PARAMS.has(p.name) &&
          !ENGINE_ON_PARAMS.includes(p.name) &&
          !FILTER_ON_PARAMS.includes(p.name)
      );

      await context.withinTransaction(() =>
        Promise.all([
          // 1. Randomiser tous les paramètres normaux
          ...randomizableParams.map(async (param: DeviceParameter<"1.0.0">) => {
            try {
              await param.setValue(randomizeParam(param, intensity));
            } catch (e) {
              console.log(`  ✗ ${param.name}: skipped (${e})`);
            }
          }),
          // 2. A On : 75% ON — B On : 75% ON
          ...engineOnParams.map(async (param: DeviceParameter<"1.0.0">) =>
            param.setValue(Math.random() < 0.25 ? 0 : 1)
          ),
          // 3. Filtres : 75% ON
          ...filterOnParams.map(async (param: DeviceParameter<"1.0.0">) =>
            param.setValue(Math.random() < 0.25 ? 0 : 1)
          ),
        ])
      );

      // 3. Garantir au moins un moteur allumé
      const engineOnValues = await Promise.all(
        engineOnParams.map((p: DeviceParameter<"1.0.0">) => p.getValue())
      );
      const anyEngineOn = engineOnValues.some((v) => v > 0);
      if (!anyEngineOn) {
        const aOn = engineOnParams.find((p: DeviceParameter<"1.0.0">) => p.name === "A On");
        if (aOn) await aOn.setValue(1);
        console.log("[Meld Randomizer] Aucun moteur actif — A forcé à ON.");
      }

      // 4. Forcer les volumes à -12dB
      await Promise.all(
        volumeParams.map((p: DeviceParameter<"1.0.0">) => p.setValue(VOLUME_MAX))
      );

      // 5. Forcer Limiter ON, Mono Poly sur Poly, Keytracking ON
      if (limiterParam) await limiterParam.setValue(1);
      if (monoPoly) await monoPoly.setValue(1);
      const keytrackingParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => ["A Keytracking", "B Keytracking"].includes(p.name)
      );
      await Promise.all(keytrackingParams.map((p: DeviceParameter<"1.0.0">) => p.setValue(1)));

      console.log(`[Meld Randomizer] ✓ "${track.name}" — ${Math.round(intensity * 100)}% — volume -12dB — limiter ON.`);
    }
  });

  context.ui.registerContextMenuAction(
    "MidiTrack",
    "Randomize Meld",
    "meld.randomize"
  );

  console.log("[Meld Randomizer] Activé.");
}
