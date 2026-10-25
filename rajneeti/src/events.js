// RAJNEETI — event cards, written so a young child can follow them.
// Each choice's run() changes G and returns a short message.

const COASTAL = ['OD', 'AP', 'TN', 'WB', 'GJ', 'KL', 'MH'];
const bigState = () => pick(STATES.filter(s => s.seats >= 14));
const tr = x => { G.trust = clamp(G.trust + x, 0, 100); };
const mom = x => { G.camp.momentum += x; };
const ground = (id, x) => { G.camp.ground[id] = Math.max(-10, G.camp.ground[id] + x); };
const appeal = (b, x) => { G.appeal.you[b] += x; };

const CAMPAIGN_EVENTS = [
  { id: 'gaffe', icon: '🎥', title: 'Fake Video!',
    text: () => 'Someone cut your speech to make you look bad. It is spreading on phones.',
    choices: () => [
      { label: '📢 Show the real video', cost: 5, run: () => { mom(-.5); tr(2); return 'People saw the truth. 👍'; } },
      { label: '😤 Fight back hard', run: () => rand() < .5 ? (mom(2), 'It worked! People cheer for you. 🎉') : (mom(-3), appeal('farmers', -2), 'Oops! The fight made it worse. 😬') },
      { label: '🙈 Ignore it', run: () => { mom(-2); return 'It slowly goes away, but it hurt a bit.'; } },
    ] },
  { id: 'defector', icon: '🚶', title: 'A Leader Wants to Leave',
    ctx: () => ({ s: bigState().id }),
    text: (G, c) => `A popular leader from ${stateById(c.s).name} wants to join the RSP.`,
    choices: (G, c) => [
      { label: '🎁 Give him a big job to stay', cost: 10, run: () => { tr(-2); return 'He stays with you.'; } },
      { label: '👋 Let him go', run: () => { ground(c.s, -4); return `He left. You lost some fans in ${stateById(c.s).name}.`; } },
    ] },
  { id: 'celebrity', icon: '🌟', title: 'Movie Star Wants to Help!',
    text: () => 'A famous film star wants to join your team.',
    choices: () => [
      { label: '🤩 Yes, welcome!', cost: 5, run: () => { appeal('youth', 3); mom(2); return 'Huge crowds come to see her! 🎉'; } },
      { label: '🙂 No, thank you', run: () => { tr(1); return 'You keep things serious.'; } },
    ] },
  { id: 'rivalscam', icon: '📰', title: 'RSP Caught Cheating!',
    text: () => 'News says an RSP minister gave a big deal to his friend.',
    choices: () => [
      { label: '📣 Tell everyone!', cost: 8, run: () => { G.camp.momA -= 3; return 'Everyone is talking about it. RSP looks bad!'; } },
      { label: '🙂 Ask for a fair check', run: () => { tr(3); G.camp.momA -= 1; return 'People like that you stay calm.'; } },
    ] },
  { id: 'farmmarch', icon: '🚜', title: 'Farmers Are Marching',
    text: () => 'Thousands of farmers walk to Delhi. They want better prices for crops.',
    choices: () => [
      { label: '🚶 Walk with them', run: () => { appeal('farmers', 4); appeal('business', -2); return 'Farmers love you! 🌾'; } },
      { label: '🤝 Meet their leaders', run: () => { appeal('farmers', 2); return 'Farmers are happy you listened.'; } },
      { label: '🙈 Stay away', run: () => { appeal('farmers', -2); appeal('business', 1); return 'Farmers feel ignored. 😕'; } },
    ] },
  { id: 'violence', icon: '🔥', title: 'Fighting in a Town',
    ctx: () => ({ s: bigState().id }),
    text: (G, c) => `People are fighting in ${stateById(c.s).name}. Everyone is scared.`,
    choices: (G, c) => [
      { label: '🕊️ Go and ask for peace', cost: 5, run: () => { tr(4); ground(c.s, 2); return 'Your peace walk calms everyone. 🕊️'; } },
      { label: '👉 Blame the state leaders', run: () => { mom(1); tr(-3); return 'Some people think that was mean.'; } },
      { label: '🤐 Say nothing', run: () => { tr(-2); return 'People noticed you were quiet.'; } },
    ] },
  { id: 'ecnotice', icon: '⚖️', title: 'Referee Warning!',
    text: () => 'The Election Commission (the referee) says you broke a rule in your speech.',
    choices: () => [
      { label: '🙏 Say sorry', run: () => { tr(2); mom(-1); return 'Saying sorry was the right thing.'; } },
      { label: '😠 Argue with the referee', run: () => { mom(1); tr(-4); return 'Your fans liked it. Others did not.'; } },
    ] },
  { id: 'donor', icon: '💼', title: 'A Rich Man Offers Money',
    text: () => 'A rich man offers ₹100 crore. But he wants a favour later…',
    choices: () => [
      { label: '💰 Take the money', run: () => { G.camp.funds += 100; tr(-3); G.camp.donorRisk += 2; return 'You got ₹100 crore. Hope it is okay… 🤔'; } },
      { label: '✋ Say no', run: () => { tr(3); return 'People trust you more! 👍'; } },
    ] },
  { id: 'debate', icon: '🎙️', title: 'TV Debate Challenge',
    text: () => 'The RSP leader wants to debate you on live TV.',
    choices: () => [
      { label: '💪 Accept!', run: () => rand() < .3 + G.trust / 150 ? (mom(4), tr(2), 'You won the debate! 🏆') : (mom(-3), 'You got nervous. Bad night. 😓') },
      { label: '🙅 Say no', run: () => { mom(-1); return 'Some say you were scared.'; } },
    ] },
  { id: 'paperleak', icon: '📝', title: 'Exam Paper Leaked',
    text: () => 'A big exam paper leaked. Students are very upset.',
    choices: () => [
      { label: '📜 Promise a strict new rule', run: () => { appeal('youth', 4); return 'Students cheer for you! 🎓'; } },
      { label: '✊ Stand with students', cost: 6, run: () => { appeal('youth', 3); mom(2); return 'You are on every TV channel!'; } },
    ] },
  { id: 'flood', icon: '🌊', title: 'Big Floods!',
    ctx: () => ({ s: pick(['AS', 'BR', 'KL', 'MH', 'OD', 'WB']) }),
    text: (G, c) => `Floods in ${stateById(c.s).name}. Many people lost their homes.`,
    choices: (G, c) => [
      { label: '🛶 Go and help them', cost: 15, run: () => { tr(3); ground(c.s, 5); return 'You helped first. People will remember! ❤️'; } },
      { label: '📦 Send food packets', cost: 4, run: () => { ground(c.s, 1); return 'Food reached the families.'; } },
    ] },
  { id: 'ticketsale', icon: '🎫', title: 'Cheating in Your Team',
    text: () => 'Some of your team members were caught taking money.',
    choices: () => [
      { label: '🚪 Kick them out', run: () => { tr(3); G.camp.cadre = Math.max(10, G.camp.cadre - 8); return 'Good job! You kept your team clean.'; } },
      { label: '🙊 Say it is not true', run: () => { tr(-5); return 'Not many people believe you. 😬'; } },
    ] },
  { id: 'trend', icon: '📈', title: 'You Are Famous Online!',
    text: () => 'Your speech went viral. Everyone is sharing it!',
    choices: () => [{ label: '🎉 Yay!', run: () => { mom(2); return 'Crores of people saw your speech!'; } }] },
  { id: 'founders', icon: '🚀', title: 'Young Inventors Want Help',
    text: () => 'Young people who start new companies ask: will you help us?',
    choices: () => [
      { label: '🚀 Yes, let us build!', run: () => { appeal('youth', 3); appeal('business', 2); return 'Young inventors love your plan!'; } },
      { label: '🌾 Focus on villages', run: () => { appeal('farmers', 1); appeal('youth', -1); return 'You talk about villages instead.'; } },
    ] },
  { id: 'donorscandal', icon: '💣', title: 'The Rich Man Wants His Favour',
    when: G => G.camp.donorRisk >= 2,
    text: () => 'News says your rich donor got special help. People are angry.',
    choices: () => [
      { label: '💸 Give the money back', cost: 40, run: () => { tr(-2); G.camp.donorRisk = 0; return 'You returned the money. Phew.'; } },
      { label: '😬 Just wait', run: () => { tr(-7); mom(-2); G.camp.donorRisk = 0; return 'The news stayed for a whole week. Ouch.'; } },
    ] },
];

const GOV_EVENTS = [
  { id: 'monsoon', icon: '☀️', title: 'No Rain!', weight: 2,
    text: () => 'The rains did not come. Crops are drying up and food is getting costly.',
    choices: () => [
      { label: '💧 Help the farmers', run: () => { oneTime(.3); mod('farmers', 5); G.eco.food += .8; return 'Farmers got help. 🌾'; } },
      { label: '🚢 Buy food from other countries', run: () => { G.eco.food += .3; mod('farmers', -6); mod('middle', 2); return 'Food stays cheap, but farmers are sad.'; } },
      { label: '🤷 Do nothing', run: () => { G.eco.food += 1.6; mod('farmers', -8); mod('poor', -4); return 'Food prices went way up. 😟'; } },
    ] },
  { id: 'oil', icon: '🛢️', title: 'Petrol Is Costly!', weight: 1.5,
    text: () => 'Oil from other countries suddenly costs a lot more.',
    choices: () => [
      { label: '⛽ Cut petrol tax', run: () => { revOnce(-.4, 4); G.eco.oil += .6; mod('middle', 2); return 'Petrol stays cheaper. The government earns less.'; } },
      { label: '💸 Let prices go up', run: () => { G.eco.oil += 1.8; mod('middle', -4); mod('poor', -2); return 'Petrol is costly. People are upset.'; } },
      { label: '🤝 Buy cheap oil from a far country', run: () => { G.eco.oil += .5; if (rand() < .4) { growthShock(-.4, 2); mod('business', -3); return 'Cheap oil, but some countries got angry with us.'; } return 'Smart deal! Cheap oil for India. 👍'; } },
    ] },
  { id: 'globalrec', icon: '🌍', title: 'The World Is Slowing Down', weight: 1,
    text: () => 'Other countries are buying less from India. Factories are worried.',
    choices: () => [
      { label: '💰 Spend to help factories', run: () => { oneTime(1.0); G.eco.global -= .8; mod('business', 3); mod('workers', 2); return 'Factories keep running. 🏭'; } },
      { label: '🧘 Wait and see', run: () => { G.eco.global -= 1.8; return 'Things slowed down a lot.'; } },
      { label: '📦 Sell cheaper to the world', run: () => { G.eco.global -= 1.1; G.eco.oil += .6; mod('business', 2); return 'Sales went up, but some prices rose.'; } },
    ] },
  { id: 'border', icon: '🏔️', title: 'Trouble at the Border', weight: 1,
    text: () => 'Soldiers from another country came into our mountains.',
    choices: () => [
      { label: '🪖 Send our army', run: () => { oneTime(.25); if (G.eco.b.defence >= 2.0 || rand() < .4) { modAll(4); tr(2); return 'They went back! India is proud of you! 🇮🇳'; } modAll(-3); return 'Our army needed better tools. They did not go back.'; } },
      { label: '🕊️ Talk to them', run: () => { if (rand() < .6) { tr(2); mod('business', 2); return 'Talking worked! Peace is back. 🕊️'; } mod('middle', -4); mod('youth', -3); return 'Talks are slow. Some say you are weak.'; } },
      { label: '🚫 Stop buying their things', run: () => { mod('youth', 3); mod('middle', 3); mod('business', -3); inflShock(.3, 2); return 'People like it, but some things cost more now.'; } },
    ] },
  { id: 'bankcrisis', icon: '🏦', title: 'A Bank Is Breaking!', weight: 1.2, when: G => !G.gov.flags.banksSafe,
    text: () => 'A big bank has run out of money. People are scared for their savings.',
    choices: () => [
      { label: '🛟 Save people\'s money', run: () => { oneTime(.8); mod('middle', 2); return 'Everyone\'s savings are safe. 😌'; } },
      { label: '🔗 Join it with a strong bank', pc: 1, run: () => { growthShock(-.4, 2); mod('middle', -2); return 'The banks joined. Things are calmer.'; } },
      { label: '🤷 Let it break', run: () => { growthShock(-1.2, 2); G.eco.sensex *= .9; mod('middle', -8); mod('business', -5); return 'People lost money. Very sad. 😢'; } },
    ] },
  { id: 'scandal', icon: '🕵️', title: 'Minister Caught Cheating!', weight: 1.4,
    text: () => 'A camera caught one of your ministers taking money.',
    choices: (G) => [
      { label: '🚪 Remove him', run: () => { tr(5); if (G.gov.allies.length && rand() < .5) { const a = pick(G.gov.allies); a.sat = clamp(a.sat - 12, 0, 100); return `Good! But he was from ${a.short}, and they are a bit upset.`; } return 'Everyone claps! You are fair. 👏'; } },
      { label: '🔍 Check first', pc: 2, run: () => { tr(1); return 'A team is checking. People wait.'; } },
      { label: '🛡️ Protect him', run: () => { tr(-8); modAll(-2); return 'People are angry that you protected a cheater. 😠'; } },
    ] },
  { id: 'boom', icon: '🐂', title: 'Share Market Is Booming!', weight: .8,
    text: () => 'Company shares are going up and up!',
    choices: () => [
      { label: '💰 Add a small tax on profits', run: () => { G.eco.b.progRev = (G.eco.b.progRev || 0) + .15; mod('business', -4); mod('middle', -2); return 'More money for the government. Business is grumpy.'; } },
      { label: '🎉 Celebrate!', run: () => { G.eco.sensex *= 1.04; mod('business', 2); return 'The world sees India growing! 📈'; } },
    ] },
  { id: 'pandemic', icon: '🦠', title: 'A New Sickness Is Spreading', weight: .3, when: G => G.gov.q > 2,
    text: () => 'A new germ is making people sick. Hospitals are filling up.',
    choices: (G) => [
      { label: '🏠 Everyone stay home', run: () => { growthShock(-5, 2); oneTime(.5); mod('poor', -6); mod('workers', -6); tr(3); return 'Fewer people got sick, but many lost work.'; } },
      { label: '💉 Vaccines and care', run: () => { oneTime(.6); growthShock(-1.5, 2); if (G.eco.humanStock > 1.1) { modAll(3); return 'Great hospitals saved lives! 🏥'; } modAll(-4); return 'Hospitals were too weak. It was hard.'; } },
      { label: '🏃 Keep working', run: () => { growthShock(-.8, 2); modAll(-7); tr(-5); return 'Many people got sick. Very sad.'; } },
    ] },
  { id: 'cyclone', icon: '🌀', title: 'Big Storm Coming!', weight: 1,
    ctx: () => ({ s: pick(COASTAL) }),
    text: (G, c) => `A huge storm is coming to ${stateById(c.s).name}.`,
    choices: (G, c) => [
      { label: '🚌 Move people to safety early', run: () => { oneTime(.1); mod('poor', 2); allySat(10, c.s); tr(2); return 'Thousands of lives saved! ❤️'; } },
      { label: '🙂 Normal help', run: () => { mod('poor', -2); allySat(-6, c.s); return 'Help was slow in far villages.'; } },
    ] },
  { id: 'farmprotest', icon: '🚜', title: 'Farmers Are Angry!', scheduled: true,
    text: () => 'Lots of farmers are sitting outside Delhi. They do not like your new farm rule.',
    choices: (G) => [
      { label: '↩️ Take the rule back', run: () => { const id = G.gov.passed.includes('farmmkt') ? 'farmmkt' : 'land'; G.gov.passed = G.gov.passed.filter(x => x !== id); G.eco.reformBoost = Math.max(0, G.eco.reformBoost - .2); mod('farmers', 8); mod('business', -3); tr(-4); return 'Farmers go home happy. 🌾'; } },
      { label: '🤝 Talk with them', pc: 3, run: () => { mod('farmers', 3); return 'Talks started. Farmers slowly go home.'; } },
      { label: '💪 Do not change', run: () => { mod('farmers', -8); if (rand() < .3) { tr(-5); modAll(-2); return 'There was pushing and shouting. Not good. 😟'; } return 'You stayed strong. Farmers are still upset.'; } },
    ] },
  { id: 'strike', icon: '✊', title: 'Workers Stop Working!', scheduled: true,
    text: () => 'Workers are on strike. They do not like the new factory rules.',
    choices: () => [
      { label: '🤝 Make rules kinder', run: () => { mod('workers', 6); mod('business', -3); return 'Workers go back to work. 🏭'; } },
      { label: '💪 Do not change', run: () => { growthShock(-.6, 1); mod('workers', -5); return 'Factories stopped for a week.'; } },
    ] },
  { id: 'fdi', icon: '🔬', title: 'Big Factory Wants to Come!', weight: 1,
    text: () => 'A big company wants to build a chip factory. Will it choose India?',
    choices: () => [
      { label: '🎁 Give them help', run: () => { oneTime(.15); mod('youth', 4); mod('business', 3); G.eco.unempMod -= .2; G.eco.reformBoost += .05; return 'They chose India! 50,000 new jobs! 🎉'; } },
      { label: '📝 Give land only', run: () => { if (rand() < .5) { mod('youth', 3); G.eco.unempMod -= .15; return 'Yes! They chose India! 🎉'; } mod('youth', -2); return 'They went to another country. 😞'; } },
      { label: '🙅 No thanks', run: () => { mod('workers', 1); return 'The factory went somewhere else.'; } },
    ] },
  { id: 'cricket', icon: '🏏', title: 'India Won the World Cup!', weight: .6,
    text: () => 'India won the Cricket World Cup! Everyone is dancing!',
    choices: () => [
      { label: '🎉 Big party for the team', run: () => { modAll(2); mod('youth', 2); return 'Selfies with the team! Everyone is happy! 🏏'; } },
      { label: '👏 Say well done', run: () => { modAll(1); return 'Well done, team India!'; } },
    ] },
  { id: 'summit', icon: '🌐', title: 'World Leaders Are Visiting', weight: .7,
    text: () => 'Leaders from many countries are coming to New Delhi.',
    choices: () => [
      { label: '✨ Show India\'s best side', run: () => { oneTime(.05); mod('middle', 3); mod('business', 3); tr(1); return 'The world is amazed by India! ✨'; } },
      { label: '🙂 Keep it simple', run: () => { tr(1); return 'A nice, simple meeting.'; } },
    ] },
  { id: 'examleak', icon: '📝', title: 'Exam Paper Leaked', weight: 1,
    text: () => 'The big doctor exam paper leaked. Students are crying.',
    choices: () => [
      { label: '📝 New exam + strict rule', pc: 1, run: () => { mod('youth', 5); return 'Students are thankful. 🎓'; } },
      { label: '👉 Blame others', run: () => { mod('youth', -4); return 'Students are angry with you.'; } },
    ] },
  { id: 'allydemand', icon: '📜', title: 'Your Friend Wants Something', weight: 1, when: G => G.gov.allies.some(a => stateById(a.key)),
    ctx: (G) => ({ key: pick(G.gov.allies.filter(a => stateById(a.key))).key }),
    text: (G, c) => { const a = G.gov.allies.find(x => x.key === c.key); return a ? `Your friend ${a.short} wants extra money for ${stateById(c.key).name}.` : 'A friend wants something.'; },
    choices: (G, c) => [
      { label: '🎁 Give it', run: () => { oneTime(.12); allySat(-3); allySat(23, c.key); return 'Your friend is happy! Others are a little jealous.'; } },
      { label: '🙅 Say no', run: () => { allySat(-18, c.key); return 'Your friend is upset. 😠'; } },
    ] },
  { id: 'prices', icon: '🧅', title: 'Onions Are So Costly!', weight: 1.5, when: G => G.eco.infl > 6,
    text: () => 'Onions and tomatoes cost too much. Every family is worried.',
    choices: () => [
      { label: '📦 Sell from government stores', run: () => { inflShock(-.6, 2); mod('farmers', -4); return 'Prices came down. 🧅'; } },
      { label: '🚢 Buy from other countries', run: () => { inflShock(-.4, 2); G.eco.forex -= 10; return 'More onions arrived.'; } },
      { label: '🤷 Do nothing', run: () => { mod('middle', -4); mod('poor', -5); return 'Families are unhappy. 😟'; } },
    ] },
  { id: 'rbiclash', icon: '🏛️', title: 'The Bank Boss Quit', weight: 2, when: G => G.gov.rbiCred < 70,
    text: () => 'The boss of India\'s main bank quit. He said you pushed him too much.',
    choices: () => [
      { label: '🎓 Pick a wise expert', run: () => { G.gov.rbiCred = Math.min(100, G.gov.rbiCred + 25); mod('business', 2); return 'Everyone trusts the new boss. 👍'; } },
      { label: '🤝 Pick your friend', run: () => { G.gov.rbiCred = Math.max(0, G.gov.rbiCred - 10); G.eco.repo = Math.max(2.5, G.eco.repo - .25); G.eco.sensex *= .96; tr(-3); return 'People are not sure about this. 🤔'; } },
    ] },
  { id: 'automation', icon: '🤖', title: 'Robots Taking Jobs', weight: .8,
    text: () => 'Computers and robots are doing work that people used to do.',
    choices: () => [
      { label: '📚 Teach people new skills', run: () => { oneTime(.1); mod('youth', 3); return 'Lots of people are learning new things! 📚'; } },
      { label: '🤖 Tax the robots', run: () => { G.eco.b.progRev = (G.eco.b.progRev || 0) + .05; mod('business', -4); mod('youth', 2); return 'A robot tax! Companies are grumpy.'; } },
      { label: '🤷 Do nothing', run: () => { mod('youth', -3); G.eco.unempMod += .1; return 'Some young people can\'t find work.'; } },
    ] },
  { id: 'familyallegation', icon: '🗞️', title: 'They Say Your Family Cheated', weight: .7,
    text: () => 'The other party says your relative got special deals.',
    choices: () => [
      { label: '🔍 Let a fair team check', pc: 1, run: () => { tr(3); return 'The check found nothing wrong! ✅'; } },
      { label: '⚖️ Go to court', run: () => { if (rand() < .5) { tr(1); return 'The court said you are right!'; } tr(-5); return 'The court case went on and on…'; } },
      { label: '🙈 Ignore it', run: () => { tr(-4); return 'People start to wonder…'; } },
    ] },
  { id: 'harvest', icon: '🌽', title: 'Super Harvest!', weight: .8,
    text: () => 'Farmers grew lots and lots of wheat and rice!',
    choices: () => [
      { label: '🛒 Government buys the extra', run: () => { oneTime(.1); mod('farmers', 5); G.eco.food -= .4; return 'Farmers got good money! 🌾'; } },
      { label: '🚢 Sell to other countries', run: () => { mod('farmers', 3); mod('business', 1); return 'India sends food to the world!'; } },
    ] },
  { id: 'stateelection', icon: '🗳️', title: 'Small Elections in States', scheduled: true,
    text: (G, c) => `${c.states.map(id => stateById(id).name).join(', ')} are choosing their state leaders.`,
    choices: (G, c) => [
      { label: '💪 Work very hard', pc: 3, run: () => stateElections(c.states, .12) },
      { label: '🙂 Work a little', pc: 1, run: () => stateElections(c.states, .03) },
      { label: '🏛️ Stay in Delhi', run: () => stateElections(c.states, -.08) },
    ] },
  { id: 'allythreat', icon: '⚠️', title: 'A Friend Wants to Leave!', scheduled: true,
    text: (G, c) => { const a = G.gov.allies.find(x => x.key === c.key); return a ? `Your friend ${a.short} (${a.seats} seats) is unhappy and may leave you!` : 'A friend is unhappy.'; },
    choices: (G, c) => [
      { label: '🎁 Give money for their state', pc: 1, run: () => { oneTime(.15); allySat(30, c.key); return 'Your friend is happy again! 🤝'; } },
      { label: '🏛️ Make their leader a minister', pc: 2, run: () => { allySat(25, c.key); tr(-1); return 'They have a minister now. Happy!'; } },
      { label: '🤞 Say "Please stay"', run: () => allyBluff(c.key) },
    ] },
  { id: 'noconfidence', icon: '⚔️', title: 'Big Vote: Should You Stay?', scheduled: true,
    text: () => `The other parties want to remove you. You have ${govSeats()} seats. You need ${MAJORITY}.`,
    choices: () => [
      { label: '🤝 Ask small parties for help', pc: 4, run: () => confidenceVote(.25) },
      { label: '🤞 Hope for the best', run: () => confidenceVote(0) },
      { label: '🗳️ Ask people to vote again', run: () => { governmentFalls('You asked for a new election.'); return 'New election coming!'; } },
    ] },
];

function stateElections(ids, bonus) {
  const won = [], lost = [];
  for (const id of ids) {
    const a = stateApproval(id);
    const allied = G.gov.allies.some(x => x.key === id);
    const p = clamp(.3 + (a - 45) / 40 + bonus + (allied ? .1 : 0), .05, .95);
    if (rand() < p) won.push(id); else lost.push(id);
  }
  G.gov.rs = clamp(G.gov.rs + won.length * 3 - lost.length * 3, 40, 200);
  G.gov.stateElectionsWon += won.length; G.gov.stateElectionsLost += lost.length;
  if (won.length > lost.length) modAll(1); else if (lost.length > won.length) modAll(-1);
  return `You won ${won.length}, lost ${lost.length}. ${won.length >= lost.length ? '🎉' : '😕'}`;
}

function allyBluff(key) {
  const a = G.gov.allies.find(x => x.key === key);
  if (!a) return 'They already left.';
  if (rand() < .5) { a.sat = clamp(a.sat + 5, 0, 100); return `${a.short} stays with you! 🤝`; }
  G.gov.allies = G.gov.allies.filter(x => x !== a);
  if (govSeats() < MAJORITY) G.gov.pendingRisk = 'noconfidence';
  return `${a.short} left you. 💔 You lost ${a.seats} seats.`;
}

function confidenceVote(bonus) {
  const seats = govSeats();
  const p = clamp(.3 + bonus + (overallApproval() - 45) / 80 + (seats - 250) / 80, .05, .95);
  if (rand() < p) { G.gov.minority = true; tr(2); return 'You won the vote! You stay PM! 🎉'; }
  governmentFalls('You lost the vote.');
  return 'You lost the vote. New election! 🗳️';
}
