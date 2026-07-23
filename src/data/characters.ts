import type { Character } from '../types'

// Trouble Brewing character data. Ability/flavor wording follows the official
// script as closely as reasonably recalled; double-check against a physical
// script/character almanac before relying on exact wording at the table.
const RAW_CHARACTERS: Omit<Character, 'wikiUrl' | 'tokenUrl'>[] = [
  // Townsfolk
  {
    id: 'washerwoman',
    name: 'Washerwoman',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'You start knowing that 1 of 2 players is a particular Townsfolk.',
    clarification: 'The Townsfolk shown is definitely in play. The other player shown is not that character.',
    flavor: 'She always has something to say about someone.',
    firstNight: 'Show a "Townsfolk" token, then point to 2 players, one of whom is that Townsfolk.',
    firstNightOrder: 4,
  },
  {
    id: 'librarian',
    name: 'Librarian',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)',
    clarification: 'If no Outsiders are in play, the Librarian is shown 2 players and told that neither is an Outsider.',
    flavor: 'She knows the location of every book — and every secret.',
    firstNight: 'Show an "Outsider" token, then point to 2 players, one of whom is that Outsider (or show "0" if none are in play).',
    firstNightOrder: 5,
  },
  {
    id: 'investigator',
    name: 'Investigator',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'You start knowing that 1 of 2 players is a particular Minion.',
    clarification: 'The Minion shown is definitely in play. The other player shown is not that character.',
    flavor: 'She has seen every lie told in this town.',
    firstNight: 'Show a "Minion" token, then point to 2 players, one of whom is that Minion.',
    firstNightOrder: 6,
  },
  {
    id: 'chef',
    name: 'Chef',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'You start knowing how many pairs of evil players there are.',
    clarification: 'Pair: two players sitting directly next to each other, both evil.',
    flavor: 'She knows a good stew needs the right number of ingredients.',
    firstNight: 'Show the "0", "1", "2", etc. token for the number of adjacent evil pairs.',
    firstNightOrder: 7,
  },
  {
    id: 'empath',
    name: 'Empath',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'Each night, you learn how many of your 2 alive neighbours are evil.',
    clarification: 'Neighbours: the nearest alive players seated clockwise and counter-clockwise, ignoring dead players and empty seats.',
    flavor: 'She feels the alignment of those around her, whether she wants to or not.',
    firstNight: 'Show the number (0, 1, or 2) of evil alive neighbours.',
    otherNights: 'Show the number (0, 1, or 2) of evil alive neighbours.',
    firstNightOrder: 8,
    otherNightsOrder: 7,
  },
  {
    id: 'fortune-teller',
    name: 'Fortune Teller',
    type: 'townsfolk',
    alignment: 'good',
    ability:
      'Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.',
    clarification: 'The "red herring" good player who registers as a Demon is chosen once, at the start of the game, and never changes.',
    flavor: 'She reads fortunes in the cards — even when the cards lie to her.',
    firstNight: 'Let them choose 2 players, then show yes/no for whether either is a Demon (accounting for the red herring).',
    otherNights: 'Let them choose 2 players, then show yes/no for whether either is a Demon (accounting for the red herring).',
    firstNightOrder: 9,
    otherNightsOrder: 8,
  },
  {
    id: 'undertaker',
    name: 'Undertaker',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'Each night*, you learn which character died by execution today.',
    clarification: '* Not on the first night. Only triggers on an execution, not a night death.',
    flavor: 'He keeps a ledger of the dead and what they once were.',
    otherNights: 'Show the character token of whoever was executed today (if anyone).',
    otherNightsOrder: 6,
  },
  {
    id: 'monk',
    name: 'Monk',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'Each night*, choose a player (not yourself): they are safe from the Demon tonight.',
    clarification: '* Not on the first night. "Safe from the Demon" only blocks the Demon\'s kill, not other effects.',
    flavor: 'He keeps a silent vigil over whichever soul needs it most.',
    otherNights: 'Let them choose a player (not themselves) to protect from the Demon tonight.',
    otherNightsOrder: 2,
  },
  {
    id: 'ravenkeeper',
    name: 'Ravenkeeper',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'If you die at night, you are woken to choose a player: you learn their character.',
    clarification: 'Only triggers if the Ravenkeeper dies at night (not by execution). They choose after learning they have died.',
    flavor: 'His raven only speaks to him once the world has gone dark.',
    otherNights: 'If they died tonight, wake them, let them choose a player, then show that player\'s character token.',
    otherNightsOrder: 5,
  },
  {
    id: 'virgin',
    name: 'Virgin',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
    clarification: 'A day-phase ability with no night action — track it as a one-time trigger on first nomination.',
    flavor: 'Her reputation alone is enough to end an accuser.',
  },
  {
    id: 'slayer',
    name: 'Slayer',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.',
    clarification: 'A day-phase, once-per-game ability with no night action.',
    flavor: 'One arrow, one shot, one chance to end the nightmare.',
  },
  {
    id: 'soldier',
    name: 'Soldier',
    type: 'townsfolk',
    alignment: 'good',
    ability: 'You are safe from the Demon.',
    clarification: 'Passive protection only against the Demon\'s kill — no night action to run.',
    flavor: 'He has survived worse nights than this one.',
  },
  {
    id: 'mayor',
    name: 'Mayor',
    type: 'townsfolk',
    alignment: 'good',
    ability:
      'If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.',
    clarification: 'Passive ability — the "die instead" redirect is the Storyteller\'s choice, not the Mayor\'s.',
    flavor: 'She has led this town through worse and will lead it through this too.',
  },
  // Outsiders
  {
    id: 'butler',
    name: 'Butler',
    type: 'outsider',
    alignment: 'good',
    ability: 'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.',
    clarification: 'This restricts the Butler\'s own vote the next day; it does not affect the chosen player.',
    flavor: 'He serves faithfully, deferring to whoever he trusts most.',
    firstNight: 'Let them choose a player whose vote will gate their own tomorrow.',
    otherNights: 'Let them choose a player whose vote will gate their own tomorrow.',
    firstNightOrder: 10,
    otherNightsOrder: 9,
  },
  {
    id: 'drunk',
    name: 'Drunk',
    type: 'outsider',
    alignment: 'good',
    ability: 'You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.',
    clarification:
      'The Drunk is told they are a specific Townsfolk and privately given that character\'s reminder tokens/info flow, but none of it is real — the Storyteller quietly fabricates whatever "results" fit the story.',
    flavor: 'He swears he saw a ghost — right after his fourth drink.',
  },
  {
    id: 'recluse',
    name: 'Recluse',
    type: 'outsider',
    alignment: 'good',
    ability: 'You might register as evil & as a Minion or Demon, even if dead.',
    clarification: 'This is the Storyteller\'s choice each time it matters — the Recluse never finds out either way.',
    flavor: 'He keeps to himself, which is exactly what makes people suspicious.',
  },
  {
    id: 'saint',
    name: 'Saint',
    type: 'outsider',
    alignment: 'good',
    ability: 'If you die by execution, your team loses.',
    clarification: 'Only triggers on execution, never on a night kill.',
    flavor: 'Her faith is absolute — and the town\'s faith in her must be too.',
  },
  // Minions
  {
    id: 'poisoner',
    name: 'Poisoner',
    type: 'minion',
    alignment: 'evil',
    ability: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
    clarification: 'Poisoned players\' abilities function as normal but the information/results they produce may be false, at the Storyteller\'s discretion.',
    flavor: 'A drop is all it takes to turn truth into lies.',
    firstNight: 'Let them choose a player to poison tonight and through tomorrow day.',
    otherNights: 'Let them choose a player to poison tonight and through tomorrow day.',
    firstNightOrder: 3,
    otherNightsOrder: 1,
  },
  {
    id: 'spy',
    name: 'Spy',
    type: 'minion',
    alignment: 'evil',
    ability: 'Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.',
    clarification: '"See the Grimoire" means the Storyteller shows/describes the current full game state to them.',
    flavor: 'She hides in plain sight, reading everyone\'s secrets but her own.',
    firstNight: 'Show them the Grimoire (all seats, characters, and statuses).',
    otherNights: 'Show them the Grimoire (all seats, characters, and statuses).',
    firstNightOrder: 11,
    otherNightsOrder: 10,
  },
  {
    id: 'scarlet-woman',
    name: 'Scarlet Woman',
    type: 'minion',
    alignment: 'evil',
    ability: 'If there are 5 or more players alive & the Demon dies, you become the Demon.',
    clarification: 'A passive, conditional trigger — the Storyteller checks it whenever the Demon dies, not something acted on every night.',
    flavor: 'She has always been waiting in the Demon\'s shadow.',
    otherNights: 'Check whether the Demon died today; if so and 5+ players are alive, she is now the Demon.',
    otherNightsOrder: 3,
  },
  {
    id: 'baron',
    name: 'Baron',
    type: 'minion',
    alignment: 'evil',
    ability: 'There are extra Outsiders in play. [+2 Outsiders]',
    clarification: 'A setup-time modifier only — applied once when characters are distributed, no night action.',
    flavor: 'He rewrites the town\'s rules before the game even begins.',
  },
  // Demon
  {
    id: 'imp',
    name: 'Imp',
    type: 'demon',
    alignment: 'evil',
    ability:
      'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
    clarification: '* On the first night the Imp does not kill — they only receive Minion/bluff info. Killing starts the second night.',
    flavor: 'It wears a friendly face until the sun goes down.',
    otherNights: 'Let them choose a player to kill tonight (self-kill passes the Imp to a Minion).',
    otherNightsOrder: 4,
  },
]

function wikiUrl(name: string): string {
  return `https://wiki.bloodontheclocktower.com/${name.replace(/ /g, '_')}`
}

function tokenUrl(id: string, alignment: Character['alignment']): string {
  return `https://release.botc.app/resources/characters/tb/${id.replace(/-/g, '')}_${alignment === 'good' ? 'g' : 'e'}.webp`
}

export const CHARACTERS: Character[] = RAW_CHARACTERS.map((c) => ({
  ...c,
  wikiUrl: wikiUrl(c.name),
  tokenUrl: tokenUrl(c.id, c.alignment),
}))

export const CHARACTERS_BY_ID: Record<string, Character> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]))

export function getCharacter(id: string): Character | undefined {
  return CHARACTERS_BY_ID[id]
}
