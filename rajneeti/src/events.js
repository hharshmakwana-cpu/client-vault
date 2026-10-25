// RAJNEETI — event cards. Each choice's run() mutates G and returns a log line.

const COASTAL = ['OD', 'AP', 'TN', 'WB', 'GJ', 'KL', 'MH'];
const bigState = () => pick(STATES.filter(s => s.seats >= 14));
const tr = x => { G.trust = clamp(G.trust + x, 0, 100); };
const mom = x => { G.camp.momentum += x; };
const ground = (id, x) => { G.camp.ground[id] = Math.max(-10, G.camp.ground[id] + x); };
const appeal = (b, x) => { G.appeal.you[b] += x; };

const CAMPAIGN_EVENTS = [
  { id: 'gaffe', icon: '🎥', title: 'Doctored Video Goes Viral',
    text: () => 'A clip of your speech, edited to make you sound anti-farmer, is spreading on WhatsApp.',
    choices: () => [
      { label: 'Press conference with the full video', cost: 5, hint: '₹5 cr · small momentum loss', run: () => { mom(-.5); tr(2); return 'You release the full speech. Most viewers see the truth.'; } },
      { label: 'Call it fake news and go on the offensive', hint: 'Gamble: big swing either way', run: () => rand() < .5 ? (mom(2), 'Your counter-attack trends nationally. Momentum up!') : (mom(-3), appeal('farmers', -2), 'The fight keeps the clip in the news. Farmers are unhappy.') },
      { label: 'Ignore it', hint: 'Momentum −2', run: () => { mom(-2); return 'The clip fades slowly but costs you.'; } },
    ] },
  { id: 'defector', icon: '🚶', title: 'Senior Leader Defects',
    ctx: () => ({ s: bigState().id }),
    text: (G, c) => `A popular three-time MP from ${stateById(c.s).name} is in talks to join the RSP.`,
    choices: (G, c) => [
      { label: 'Offer a party post and a ticket for his son', cost: 10, hint: '₹10 cr · trust −2', run: () => { tr(-2); return 'He stays, but critics call it dynasty politics.'; } },
      { label: 'Let him go', hint: `Local support in ${stateById(c.s).name} −4`, run: () => { ground(c.s, -4); return `He joins the RSP, taking supporters in ${stateById(c.s).name} with him.`; } },
    ] },
  { id: 'celebrity', icon: '🌟', title: 'Film Star Wants to Join',
    text: () => 'A hugely popular film star wants to join your party and campaign for you.',
    choices: () => [
      { label: 'Welcome her with a grand event', cost: 5, hint: 'Youth +3, momentum +2', run: () => { appeal('youth', 3); mom(2); return 'Crowds double at rallies wherever she appears.'; } },
      { label: 'Politely decline', hint: 'Trust +1', run: () => { tr(1); return 'You say politics needs serious people. Some respect it.'; } },
    ] },
  { id: 'rivalscam', icon: '📰', title: 'Scam Hits the Government',
    text: () => 'Reports say a minister in the RSP government steered a ₹4,000 cr defence contract to a crony.',
    choices: () => [
      { label: 'Raise it in every speech', cost: 8, hint: 'RSP momentum −3', run: () => { G.camp.momA -= 3; return 'The scam dominates headlines. The government is on the back foot.'; } },
      { label: 'Demand a probe, stay positive', hint: 'Trust +3, RSP momentum −1', run: () => { tr(3); G.camp.momA -= 1; return 'You look statesmanlike.'; } },
    ] },
  { id: 'farmmarch', icon: '🚜', title: 'Farmers March to Delhi',
    text: () => 'Thousands of farmers are marching to Delhi demanding better crop prices.',
    choices: () => [
      { label: 'Join the march', hint: 'Farmers +4, Business −2', run: () => { appeal('farmers', 4); appeal('business', -2); return 'Photos of you marching with farmers go everywhere.'; } },
      { label: 'Meet their leaders privately', hint: 'Farmers +2', run: () => { appeal('farmers', 2); return 'Farm unions appreciate the quiet meeting.'; } },
      { label: 'Stay away', hint: 'Farmers −2, Business +1', run: () => { appeal('farmers', -2); appeal('business', 1); return 'Farm unions call you indifferent.'; } },
    ] },
  { id: 'violence', icon: '🔥', title: 'Violence After Local Clash',
    ctx: () => ({ s: bigState().id }),
    text: (G, c) => `A local dispute in ${stateById(c.s).name} has spiralled into violence. Tensions are high.`,
    choices: (G, c) => [
      { label: 'Visit victims, appeal for peace', cost: 5, hint: `Trust +4, ${stateById(c.s).name} +2`, run: () => { tr(4); ground(c.s, 2); return 'Your peace march earns praise across communities.'; } },
      { label: 'Blame the state government', hint: 'Momentum +1, trust −3', run: () => { mom(1); tr(-3); return 'Your attack gets coverage but looks opportunistic.'; } },
      { label: 'Stay silent', hint: 'Trust −2', run: () => { tr(-2); return 'Your silence is noticed.'; } },
    ] },
  { id: 'ecnotice', icon: '⚖️', title: 'Election Commission Notice',
    text: () => 'The Election Commission says one of your speeches broke the Model Code of Conduct.',
    choices: () => [
      { label: 'Apologise and comply', hint: 'Trust +2, momentum −1', run: () => { tr(2); mom(-1); return 'You apologise. The story dies quickly.'; } },
      { label: 'Defy it, call the EC biased', hint: 'Momentum +1, trust −4', run: () => { mom(1); tr(-4); return 'Your base loves it. Neutral voters do not.'; } },
    ] },
  { id: 'donor', icon: '💼', title: 'A Generous Donor',
    text: () => 'A mining magnate offers ₹100 cr — and hints he would like a coal block later.',
    choices: () => [
      { label: 'Accept the money', hint: '+₹100 cr, trust −3, risky', run: () => { G.camp.funds += 100; tr(-3); G.camp.donorRisk += 2; return '₹100 cr lands in party accounts.'; } },
      { label: 'Refuse publicly', hint: 'Trust +3', run: () => { tr(3); return 'Your refusal makes headlines. Clean politics!'; } },
    ] },
  { id: 'debate', icon: '🎙️', title: 'Debate Challenge',
    text: () => `${RIVALS.A.leader} challenges you to a live TV debate.`,
    choices: () => [
      { label: 'Accept the debate', hint: 'Big swing — better with high trust', run: () => rand() < .3 + G.trust / 150 ? (mom(4), tr(2), 'You win the debate decisively! Momentum surges.') : (mom(-3), 'You stumble on economic questions. A bad night.') },
      { label: 'Decline', hint: 'Momentum −1', run: () => { mom(-1); return 'Rivals mock you as scared of debate.'; } },
    ] },
  { id: 'paperleak', icon: '📝', title: 'Exam Paper Leak',
    text: () => 'A national entrance-exam paper has leaked. Lakhs of students are furious.',
    choices: () => [
      { label: 'Promise a strict anti-leak law', hint: 'Youth +4', run: () => { appeal('youth', 4); return 'Students rally behind your promise.'; } },
      { label: 'Lead student protests', cost: 6, hint: 'Youth +3, momentum +2', run: () => { appeal('youth', 3); mom(2); return 'You join students on the streets. Huge coverage.'; } },
    ] },
  { id: 'flood', icon: '🌊', title: 'Floods Devastate a State',
    ctx: () => ({ s: pick(['AS', 'BR', 'KL', 'MH', 'OD', 'WB']) }),
    text: (G, c) => `Severe floods in ${stateById(c.s).name}. Lakhs are displaced.`,
    choices: (G, c) => [
      { label: 'Pause campaign, lead relief work', cost: 15, hint: `Trust +3, ${stateById(c.s).name} +5`, run: () => { tr(3); ground(c.s, 5); return 'Your volunteers are first on the ground. People remember.'; } },
      { label: 'Send a party relief team', cost: 4, hint: `${stateById(c.s).name} +1`, run: () => { ground(c.s, 1); return 'Party workers distribute food packets.'; } },
    ] },
  { id: 'ticketsale', icon: '🎫', title: 'Ticket-for-Cash Sting',
    text: () => 'A TV sting shows party officials asking for money in exchange for election tickets.',
    choices: () => [
      { label: 'Expel them immediately', hint: 'Trust +3, cadre −8', run: () => { tr(3); G.camp.cadre = Math.max(10, G.camp.cadre - 8); return 'Swift action limits the damage.'; } },
      { label: 'Call the sting doctored', hint: 'Trust −5', run: () => { tr(-5); return 'Few believe your denial.'; } },
    ] },
  { id: 'trend', icon: '📈', title: 'You Are Trending!',
    text: () => `#${G.leader.split(' ')[0]}ForPM is trending after a heartfelt speech goes viral.`,
    choices: () => [{ label: 'Ride the wave', hint: 'Momentum +2', run: () => { mom(2); return 'Your speech is shared crores of times.'; } }] },
  { id: 'founders', icon: '🚀', title: "Startup Founders' Open Letter",
    text: () => 'Top startup founders publish a letter asking parties for a clear plan on jobs and innovation.',
    choices: () => [
      { label: 'Meet them and unveil a startup plan', hint: 'Youth +3, Business +2', run: () => { appeal('youth', 3); appeal('business', 2); return 'Founders praise your plan.'; } },
      { label: 'Focus on rural voters instead', hint: 'Farmers +1, Youth −1', run: () => { appeal('farmers', 1); appeal('youth', -1); return 'You stick to the rural message.'; } },
    ] },
  { id: 'donorscandal', icon: '💣', title: 'Donor Scandal Erupts',
    when: G => G.camp.donorRisk >= 2,
    text: () => 'Journalists reveal that one of your big donors got a state contract under your party. The press is relentless.',
    choices: () => [
      { label: 'Return the donation', cost: 40, hint: '₹40 cr, trust −2', run: () => { tr(-2); G.camp.donorRisk = 0; return 'You return the money. Damage contained.'; } },
      { label: 'Tough it out', hint: 'Trust −7, momentum −2', run: () => { tr(-7); mom(-2); G.camp.donorRisk = 0; return 'The scandal runs for a week.'; } },
    ] },
];

const GOV_EVENTS = [
  { id: 'monsoon', icon: '☀️', title: 'Monsoon Fails', weight: 2,
    text: () => 'Rainfall is 25% below normal. Crops are wilting and food prices are rising.',
    choices: () => [
      { label: 'Drought relief package', hint: '0.3% GDP · Farmers +5 · food inflation eased', run: () => { oneTime(.3); mod('farmers', 5); G.eco.food += .8; return 'Relief reaches drought-hit districts.'; } },
      { label: 'Ban food exports, import pulses', hint: 'Farmers −6 · Middle +2 · inflation low', run: () => { G.eco.food += .3; mod('farmers', -6); mod('middle', 2); return 'Prices are stable, but farmers lose export income.'; } },
      { label: 'Let markets adjust', hint: 'Farmers −8 · Poor −4 · inflation spike', run: () => { G.eco.food += 1.6; mod('farmers', -8); mod('poor', -4); return 'Food inflation spikes.'; } },
    ] },
  { id: 'oil', icon: '🛢️', title: 'Oil Price Shock', weight: 1.5,
    text: () => 'War in the Gulf sends crude to $130 a barrel. India imports 85% of its oil.',
    choices: () => [
      { label: 'Cut fuel excise duty', hint: 'Revenue −0.4% GDP · Middle +2 · less inflation', run: () => { revOnce(-.4, 4); G.eco.oil += .6; mod('middle', 2); return 'Petrol prices held steady at a cost to the treasury.'; } },
      { label: 'Pass prices on to consumers', hint: 'Inflation spike · Middle −4 · Poor −2', run: () => { G.eco.oil += 1.8; mod('middle', -4); mod('poor', -2); return 'Petrol crosses ₹130/litre. Commuters are angry.'; } },
      { label: 'Buy discounted oil from a sanctioned seller', hint: 'Cheaper oil, diplomatic risk', run: () => { G.eco.oil += .5; if (rand() < .4) { growthShock(-.4, 2); mod('business', -3); return 'Cheap oil flows, but Western partners slap tariffs on Indian goods.'; } return 'Discounted barrels keep prices in check. A diplomatic win.'; } },
    ] },
  { id: 'globalrec', icon: '🌍', title: 'Global Recession', weight: 1,
    text: () => 'The US and Europe slide into recession. Indian exports are falling fast.',
    choices: () => [
      { label: 'Fiscal stimulus', hint: '1% GDP · growth protected · Business +3', run: () => { oneTime(1.0); G.eco.global -= .8; mod('business', 3); mod('workers', 2); return 'A big stimulus cushions the blow.'; } },
      { label: 'Stay the course', hint: 'Growth hit · deficit safe', run: () => { G.eco.global -= 1.8; return 'You hold the line on the deficit. Growth suffers.'; } },
      { label: 'Let the rupee fall to boost exports', hint: 'Smaller growth hit · imported inflation', run: () => { G.eco.global -= 1.1; G.eco.oil += .6; mod('business', 2); return 'The rupee falls 8%. Exporters cheer; importers groan.'; } },
    ] },
  { id: 'border', icon: '🏔️', title: 'Border Standoff', weight: 1,
    text: () => 'Troops of a neighbouring country have crossed into disputed territory in the Himalayas.',
    choices: () => [
      { label: 'Military build-up', hint: 'Costs 0.25% GDP · outcome depends on defence budget', run: () => { oneTime(.25); if (G.eco.b.defence >= 2.0 || rand() < .4) { modAll(4); tr(2); return 'Our forces stand firm and the intruders pull back. The nation rallies behind you!'; } modAll(-3); return 'Under-equipped forces cannot force a pullback. Critics question defence cuts.'; } },
      { label: 'Diplomatic talks', hint: 'Usually works, can look weak', run: () => { if (rand() < .6) { tr(2); mod('business', 2); return 'Quiet diplomacy defuses the crisis.'; } mod('middle', -4); mod('youth', -3); return 'Talks drag on. You are called weak on TV.'; } },
      { label: 'Ban their apps and imports', hint: 'Middle/Youth +3 · Business −3 · some inflation', run: () => { mod('youth', 3); mod('middle', 3); mod('business', -3); inflShock(.3, 2); return 'Economic retaliation is popular, but prices rise.'; } },
    ] },
  { id: 'bankcrisis', icon: '🏦', title: 'Major Bank Collapses', weight: 1.2, when: G => !G.gov.flags.banksSafe,
    text: () => 'A large private bank is insolvent after years of bad loans. Depositors are queueing outside branches.',
    choices: () => [
      { label: 'Bail out depositors', hint: '0.8% GDP · Middle +2', run: () => { oneTime(.8); mod('middle', 2); return 'Deposits are guaranteed. Panic subsides.'; } },
      { label: 'Merge it into a state bank', pc: 1, hint: '1 PC · small growth hit', run: () => { growthShock(-.4, 2); mod('middle', -2); return 'A forced merger stabilises things.'; } },
      { label: 'Let it fail', hint: 'Growth −1.2 · Middle −8 · markets crash', run: () => { growthShock(-1.2, 2); G.eco.sensex *= .9; mod('middle', -8); mod('business', -5); return 'Savers lose money. Markets tumble.'; } },
    ] },
  { id: 'scandal', icon: '🕵️', title: 'Minister in Bribery Sting', weight: 1.4,
    text: (G) => G.gov.flags.lokpal ? 'The new Lokpal has caught a minister taking bribes on camera.' : 'A TV channel catches a cabinet minister taking a bribe on camera.',
    choices: (G) => [
      { label: 'Sack the minister', hint: 'Trust +5 · may upset an ally', run: () => { tr(5); if (G.gov.allies.length && rand() < .5) { const a = pick(G.gov.allies); a.sat = clamp(a.sat - 12, 0, 100); return `You sack the minister — an ${a.short} leader. Trust up, ${a.short} sulks.`; } return 'You sack the minister within hours. Public applauds.'; } },
      { label: 'Order an inquiry', pc: 2, hint: '2 PC · Trust +1', run: () => { tr(1); return 'An inquiry is ordered. The story slowly fades.'; } },
      { label: 'Defend the minister', hint: 'Trust −8 · all −2', run: () => { tr(-8); modAll(-2); return 'Defending him looks terrible.'; } },
    ] },
  { id: 'boom', icon: '🐂', title: 'Stock Market Euphoria', weight: .8,
    text: () => 'The Sensex hits record highs as foreign money pours in.',
    choices: () => [
      { label: 'Raise capital gains tax', hint: 'Revenue +0.15% GDP · Business −4', run: () => { G.eco.b.progRev = (G.eco.b.progRev || 0) + .15; mod('business', -4); mod('middle', -2); return 'Markets dip on the new tax.'; } },
      { label: "Celebrate India's growth story", hint: 'Business +2', run: () => { G.eco.sensex *= 1.04; mod('business', 2); return 'Global investors take note.'; } },
    ] },
  { id: 'pandemic', icon: '🦠', title: 'New Virus Spreading', weight: .3, when: G => G.gov.q > 2,
    text: () => 'A new respiratory virus is spreading fast in major cities. Hospitals are filling up.',
    choices: (G) => [
      { label: 'Strict national lockdown', hint: 'Growth −5 for 2 qtrs · Poor & Workers −6 · Trust +3', run: () => { growthShock(-5, 2); oneTime(.5); mod('poor', -6); mod('workers', -6); tr(3); return 'The country shuts down. Cases fall, but livelihoods suffer.'; } },
      { label: 'Targeted containment + vaccines', hint: '0.6% GDP · works if health system is strong', run: () => { oneTime(.6); growthShock(-1.5, 2); if (G.eco.humanStock > 1.1) { modAll(3); return 'A strong health system contains the outbreak. A model for the world!'; } modAll(-4); return 'Weak hospitals are overwhelmed. Painful scenes.'; } },
      { label: 'Keep the economy open', hint: 'Growth −0.8 · all −7 · Trust −5', run: () => { growthShock(-.8, 2); modAll(-7); tr(-5); return 'The economy hums, but the human cost is grim.'; } },
    ] },
  { id: 'cyclone', icon: '🌀', title: 'Super Cyclone', weight: 1,
    ctx: () => ({ s: pick(COASTAL) }),
    text: (G, c) => `A super cyclone is about to hit ${stateById(c.s).name}.`,
    choices: (G, c) => [
      { label: 'Evacuate early, massive relief', hint: '0.1% GDP · Poor +2 · ally pleased', run: () => { oneTime(.1); mod('poor', 2); allySat(10, c.s); tr(2); return 'Early evacuation saves thousands of lives.'; } },
      { label: 'Standard disaster response', hint: 'Poor −2', run: () => { mod('poor', -2); allySat(-6, c.s); return 'Relief is slow in remote villages.'; } },
    ] },
  { id: 'farmprotest', icon: '🚜', title: 'Farmers Besiege Delhi', scheduled: true,
    text: () => 'Lakhs of farmers have camped at Delhi\'s borders against your farm/land reforms.',
    choices: (G) => [
      { label: 'Repeal the law', hint: 'Farmers +8 · Trust −4 · lose reform gains', run: () => { const id = G.gov.passed.includes('farmmkt') ? 'farmmkt' : 'land'; G.gov.passed = G.gov.passed.filter(x => x !== id); G.eco.reformBoost = Math.max(0, G.eco.reformBoost - .2); mod('farmers', 8); mod('business', -3); tr(-4); return 'You repeal the law. Farmers celebrate; reformers despair.'; } },
      { label: 'Form a negotiation committee', pc: 3, hint: '3 PC · Farmers +3', run: () => { mod('farmers', 3); return 'Talks begin. Protesters slowly go home.'; } },
      { label: 'Stand firm', hint: 'Farmers −8 · risky', run: () => { mod('farmers', -8); if (rand() < .3) { tr(-5); modAll(-2); return 'Police clash with farmers. Ugly images shock the nation.'; } return 'You hold firm. The protest drags on.'; } },
    ] },
  { id: 'strike', icon: '✊', title: 'Nationwide General Strike', scheduled: true,
    text: () => 'Twenty crore workers strike against the Labour Codes. Factories and ports are shut.',
    choices: () => [
      { label: 'Add worker safeguards', hint: 'Workers +6 · Business −3', run: () => { mod('workers', 6); mod('business', -3); return 'Unions call off the strike.'; } },
      { label: 'Stand firm', hint: 'Growth hit · Workers −5', run: () => { growthShock(-.6, 1); mod('workers', -5); return 'The strike fizzles after a costly week.'; } },
    ] },
  { id: 'fdi', icon: '🔬', title: 'Chipmaker Wants to Build in India', weight: 1,
    text: () => 'A global chip giant is choosing between India and Vietnam for a ₹1 lakh crore fab.',
    choices: () => [
      { label: 'Offer big subsidies', hint: '0.15% GDP · Youth +4 · jobs', run: () => { oneTime(.15); mod('youth', 4); mod('business', 3); G.eco.unempMod -= .2; G.eco.reformBoost += .05; return 'The fab is coming to India! 50,000 jobs.'; } },
      { label: 'Offer land and fast approvals only', hint: '50/50', run: () => { if (rand() < .5) { mod('youth', 3); G.eco.unempMod -= .15; return 'Fast approvals win the day. The fab picks India!'; } mod('youth', -2); return 'The company picks Vietnam.'; } },
      { label: 'Decline — no corporate handouts', hint: 'Workers +1', run: () => { mod('workers', 1); return 'The fab goes elsewhere.'; } },
    ] },
  { id: 'cricket', icon: '🏏', title: 'India Wins the World Cup!', weight: .6,
    text: () => 'India has won the Cricket World Cup! The nation is celebrating.',
    choices: () => [
      { label: 'Host a grand reception', hint: 'All +2, Youth +2', run: () => { modAll(2); mod('youth', 2); return 'Selfies with the team go viral.'; } },
      { label: 'Congratulate them on social media', hint: 'All +1', run: () => { modAll(1); return 'A warm message for the team.'; } },
    ] },
  { id: 'summit', icon: '🌐', title: 'India Hosts a Global Summit', weight: .7,
    text: () => 'World leaders are coming to New Delhi for a major summit.',
    choices: () => [
      { label: 'Lavish showcase of India', hint: '0.05% GDP · Middle & Business +3', run: () => { oneTime(.05); mod('middle', 3); mod('business', 3); tr(1); return 'A dazzling summit puts India on the world stage.'; } },
      { label: 'Keep it modest', hint: 'Trust +1', run: () => { tr(1); return 'A businesslike summit.'; } },
    ] },
  { id: 'examleak', icon: '📝', title: 'Exam Paper Leak', weight: 1,
    text: () => 'The national medical entrance exam paper has leaked. 20 lakh students are affected.',
    choices: () => [
      { label: 'Re-exam + tough anti-leak law', pc: 1, hint: '1 PC · Youth +5', run: () => { mod('youth', 5); return 'Swift action calms students.'; } },
      { label: 'Blame state agencies', hint: 'Youth −4', run: () => { mod('youth', -4); return 'Students march against the government.'; } },
    ] },
  { id: 'allydemand', icon: '📜', title: 'Ally Demands Special Status', weight: 1, when: G => G.gov.allies.some(a => stateById(a.key)),
    ctx: (G) => ({ key: pick(G.gov.allies.filter(a => stateById(a.key))).key }),
    text: (G, c) => { const a = G.gov.allies.find(x => x.key === c.key); return a ? `The ${a.name} demands special category status and funds for ${stateById(c.key).name}.` : 'An ally makes demands.'; },
    choices: (G, c) => [
      { label: 'Grant a special package', hint: '0.12% GDP · ally +20 · other allies −3', run: () => { oneTime(.12); allySat(-3); allySat(23, c.key); return 'The package is announced. Other states grumble.'; } },
      { label: 'Refuse', hint: 'Ally −18', run: () => { allySat(-18, c.key); return 'Your ally is furious.'; } },
    ] },
  { id: 'prices', icon: '🧅', title: 'Onion & Tomato Prices Soar', weight: 1.5, when: G => G.eco.infl > 6,
    text: () => 'Onions at ₹120/kg. Every TV channel is running the story.',
    choices: () => [
      { label: 'Release buffer stocks, cap prices', hint: 'Inflation eases · Farmers −4', run: () => { inflShock(-.6, 2); mod('farmers', -4); return 'Prices cool down.'; } },
      { label: 'Import onions', hint: 'Inflation eases a little · forex −10', run: () => { inflShock(-.4, 2); G.eco.forex -= 10; return 'Imported onions arrive.'; } },
      { label: 'Do nothing', hint: 'Middle −4 · Poor −5', run: () => { mod('middle', -4); mod('poor', -5); return 'Kitchens feel the pinch.'; } },
    ] },
  { id: 'rbiclash', icon: '🏛️', title: 'RBI Governor Resigns', weight: 2, when: G => G.gov.rbiCred < 70,
    text: () => 'The RBI Governor resigns, citing government interference in monetary policy.',
    choices: () => [
      { label: 'Appoint a respected economist', hint: 'RBI credibility +25 · Business +2', run: () => { G.gov.rbiCred = Math.min(100, G.gov.rbiCred + 25); mod('business', 2); return 'Markets welcome the appointment.'; } },
      { label: 'Appoint a loyalist', hint: 'Rate cut · credibility falls · Trust −3', run: () => { G.gov.rbiCred = Math.max(0, G.gov.rbiCred - 10); G.eco.repo = Math.max(2.5, G.eco.repo - .25); G.eco.sensex *= .96; tr(-3); return 'Markets wobble at the pick.'; } },
    ] },
  { id: 'automation', icon: '🤖', title: 'AI Wipes Out IT Jobs', weight: .8,
    text: () => 'IT firms announce 3 lakh layoffs as AI automates software and back-office work.',
    choices: () => [
      { label: 'National reskilling fund', hint: '0.1% GDP · Youth +3', run: () => { oneTime(.1); mod('youth', 3); return 'Lakhs enrol in AI reskilling.'; } },
      { label: 'Tax automation', hint: 'Revenue +0.05 · Business −4 · Youth +2', run: () => { G.eco.b.progRev = (G.eco.b.progRev || 0) + .05; mod('business', -4); mod('youth', 2); return 'A first-of-its-kind automation tax.'; } },
      { label: 'Let the market adjust', hint: 'Youth −3', run: () => { mod('youth', -3); G.eco.unempMod += .1; return 'Graduates struggle to find work.'; } },
    ] },
  { id: 'familyallegation', icon: '🗞️', title: 'Allegations Against Your Family', weight: .7,
    text: () => 'The opposition alleges that a firm linked to your relative won highway contracts.',
    choices: () => [
      { label: 'Order an independent probe', pc: 1, hint: '1 PC · Trust +3', run: () => { tr(3); return 'The probe finds nothing. You come out cleaner.'; } },
      { label: 'Sue for defamation', hint: 'Gamble', run: () => { if (rand() < .5) { tr(1); return 'The court sides with you.'; } tr(-5); return 'The lawsuit keeps the story alive for months.'; } },
      { label: 'Ignore it', hint: 'Trust −4', run: () => { tr(-4); return 'Silence breeds suspicion.'; } },
    ] },
  { id: 'harvest', icon: '🌽', title: 'Bumper Harvest', weight: .8,
    text: () => 'Record wheat and rice crops! Granaries are overflowing.',
    choices: () => [
      { label: 'Increase government procurement', hint: '0.1% GDP · Farmers +5', run: () => { oneTime(.1); mod('farmers', 5); G.eco.food -= .4; return 'Farmers get good prices.'; } },
      { label: 'Allow exports', hint: 'Farmers +3 · Business +1', run: () => { mod('farmers', 3); mod('business', 1); return 'Exports boom.'; } },
    ] },
  { id: 'stateelection', icon: '🗳️', title: 'State Assembly Elections', scheduled: true,
    text: (G, c) => `Assembly elections in ${c.states.map(id => stateById(id).name).join(', ')}. Results decide Rajya Sabha seats and your momentum.`,
    choices: (G, c) => [
      { label: 'Campaign hard', pc: 3, hint: '3 PC · best odds', run: () => stateElections(c.states, .12) },
      { label: 'Moderate campaign', pc: 1, hint: '1 PC', run: () => stateElections(c.states, .03) },
      { label: 'Stay above the fray', hint: 'Focus on governing', run: () => stateElections(c.states, -.08) },
    ] },
  { id: 'allythreat', icon: '⚠️', title: 'Ally Threatens to Quit', scheduled: true,
    text: (G, c) => { const a = G.gov.allies.find(x => x.key === c.key); return a ? `The ${a.name} (${a.seats} MPs) says it will quit your coalition unless its demands are met.` : 'An ally is restless.'; },
    choices: (G, c) => [
      { label: 'Special package for their state', pc: 1, hint: '1 PC · 0.15% GDP · ally +30', run: () => { oneTime(.15); allySat(30, c.key); return 'The ally is placated.'; } },
      { label: 'Give them a big ministry', pc: 2, hint: '2 PC · ally +25 · Trust −1', run: () => { allySat(25, c.key); tr(-1); return 'Their leader becomes a cabinet minister.'; } },
      { label: 'Call their bluff', hint: '50/50', run: () => allyBluff(c.key) },
    ] },
  { id: 'noconfidence', icon: '⚔️', title: 'No-Confidence Motion', scheduled: true,
    text: () => `The opposition moves a no-confidence motion. You have ${govSeats()} MPs; ${MAJORITY} needed.`,
    choices: () => [
      { label: 'Win over small parties & independents', pc: 4, hint: '4 PC · decent odds', run: () => confidenceVote(.25) },
      { label: 'Appeal to MPs\' conscience', hint: 'Risky', run: () => confidenceVote(0) },
      { label: 'Resign and seek a fresh mandate', hint: 'Snap election', run: () => { governmentFalls('You resign to seek a fresh mandate.'); return 'Snap elections called.'; } },
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
  const name = id => stateById(id).name;
  return `State results — won: ${won.map(name).join(', ') || 'none'}; lost: ${lost.map(name).join(', ') || 'none'}. Rajya Sabha now ${G.gov.rs}/${RS_TOTAL}.`;
}

function allyBluff(key) {
  const a = G.gov.allies.find(x => x.key === key);
  if (!a) return 'The ally has already left.';
  if (rand() < .5) { a.sat = clamp(a.sat + 5, 0, 100); return `${a.short} backs down. Your authority grows.`; }
  G.gov.allies = G.gov.allies.filter(x => x !== a);
  if (govSeats() < MAJORITY) G.gov.pendingRisk = 'noconfidence';
  return `${a.short} quits your coalition, taking ${a.seats} MPs with them!`;
}

function confidenceVote(bonus) {
  const seats = govSeats();
  const p = clamp(.3 + bonus + (overallApproval() - 45) / 80 + (seats - 250) / 80, .05, .95);
  if (rand() < p) { G.gov.minority = true; tr(2); return `You survive the no-confidence motion! Outside support keeps you in power.`; }
  governmentFalls('You lose the no-confidence vote.');
  return 'Your government falls on the floor of the House.';
}
