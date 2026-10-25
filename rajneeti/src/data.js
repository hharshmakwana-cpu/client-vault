// RAJNEETI — static game data. All parties and people are fictional.

const BLOCS = [
  { id: 'farmers',  name: 'Farmers',      icon: '🌾', nat: 0.24 },
  { id: 'poor',     name: 'Poor families',   icon: '🛖', nat: 0.22 },
  { id: 'workers',  name: 'Workers',      icon: '🏭', nat: 0.14 },
  { id: 'middle',   name: 'City families', icon: '🏠', nat: 0.18 },
  { id: 'youth',    name: 'Young people',        icon: '🎓', nat: 0.14 },
  { id: 'business', name: 'Business people',     icon: '💼', nat: 0.08 },
];

// base: starting strength [you, RSP, NBM, regional]. pos: [col,row] on tile map.
// reg: regional party (null = scattered independents, cannot ally).
// lean: regional party's starting affinity toward you (0..1). dislikes: reform tags it opposes.
const STATES = [
  { id: 'JK', name: 'Jammu & Kashmir',  seats: 6,  urban: .27, pos: [2, 0], base: [24, 34, 4, 38], reg: { name: 'Kashmir National Front', short: 'KNF', lean: .6, dislikes: ['centralise'] } },
  { id: 'PB', name: 'Punjab',           seats: 13, urban: .37, pos: [1, 1], base: [34, 16, 22, 28], reg: { name: 'Panth Kisan Dal', short: 'PKD', lean: .45, dislikes: ['farm', 'land'] } },
  { id: 'HP', name: 'Himachal Pradesh', seats: 4,  urban: .10, pos: [2, 1], base: [44, 48, 4, 4], reg: null },
  { id: 'UK', name: 'Uttarakhand',      seats: 5,  urban: .30, pos: [3, 1], base: [38, 52, 4, 6], reg: null },
  { id: 'RJ', name: 'Rajasthan',        seats: 25, urban: .25, pos: [0, 2], base: [40, 46, 4, 10], reg: null },
  { id: 'HR', name: 'Haryana',          seats: 10, urban: .35, pos: [1, 2], base: [36, 42, 6, 16], reg: { name: 'Haryana Lok Dal', short: 'HLD', lean: .4, dislikes: ['farm', 'land'] } },
  { id: 'DL', name: 'Delhi',            seats: 7,  urban: .98, pos: [2, 2], base: [22, 44, 32, 2], reg: null },
  { id: 'UP', name: 'Uttar Pradesh',    seats: 80, urban: .23, pos: [3, 2], base: [24, 38, 6, 30], reg: { name: 'Awadh Lok Manch', short: 'ALM', lean: .55, dislikes: ['labour', 'anticorruption'] } },
  { id: 'BR', name: 'Bihar',            seats: 40, urban: .12, pos: [4, 2], base: [20, 32, 6, 42], reg: { name: 'Magadh Janata Dal', short: 'MJD', lean: .35, dislikes: ['anticorruption', 'centralise'] } },
  { id: 'AS', name: 'Assam',            seats: 14, urban: .14, pos: [6, 2], base: [30, 42, 4, 24], reg: { name: 'Asom Jatiya Parishad', short: 'AJP', lean: .4, dislikes: ['centralise'] } },
  { id: 'NE', name: 'North-East (6 states)', seats: 11, urban: .25, pos: [7, 2], base: [26, 36, 4, 34], reg: { name: "North-East People's Alliance", short: 'NEPA', lean: .45, dislikes: ['land', 'centralise'] } },
  { id: 'GJ', name: 'Gujarat',          seats: 26, urban: .43, pos: [0, 3], base: [30, 58, 4, 8], reg: null },
  { id: 'MP', name: 'Madhya Pradesh',   seats: 29, urban: .28, pos: [1, 3], base: [38, 48, 4, 10], reg: null },
  { id: 'CG', name: 'Chhattisgarh',     seats: 11, urban: .23, pos: [2, 3], base: [40, 46, 4, 10], reg: null },
  { id: 'JH', name: 'Jharkhand',        seats: 14, urban: .24, pos: [3, 3], base: [24, 36, 4, 36], reg: { name: 'Jharkhand Adivasi Morcha', short: 'JAM', lean: .6, dislikes: ['land', 'market'] } },
  { id: 'WB', name: 'West Bengal',      seats: 42, urban: .32, pos: [4, 3], base: [12, 30, 8, 50], reg: { name: 'Bangla Matri Sangha', short: 'BMS', lean: .5, dislikes: ['labour', 'market', 'centralise'] } },
  { id: 'MH', name: 'Maharashtra',      seats: 48, urban: .45, pos: [0, 4], base: [28, 36, 8, 28], reg: { name: 'Maratha Swabhiman Sena', short: 'MSS', lean: .4, dislikes: ['farm'] } },
  { id: 'TG', name: 'Telangana',        seats: 17, urban: .39, pos: [1, 4], base: [32, 24, 4, 40], reg: { name: 'Telangana Praja Samithi', short: 'TPS', lean: .45, dislikes: ['centralise'] } },
  { id: 'OD', name: 'Odisha',           seats: 21, urban: .17, pos: [2, 4], base: [18, 32, 4, 46], reg: { name: 'Utkal Jana Dal', short: 'UJD', lean: .4, dislikes: ['land'] } },
  { id: 'GA', name: 'Goa',              seats: 2,  urban: .62, pos: [0, 5], base: [36, 46, 10, 8], reg: null },
  { id: 'KA', name: 'Karnataka',        seats: 28, urban: .39, pos: [1, 5], base: [38, 40, 4, 18], reg: { name: 'Kannada Raitha Paksha', short: 'KRP', lean: .45, dislikes: ['farm'] } },
  { id: 'AP', name: 'Andhra Pradesh',   seats: 25, urban: .30, pos: [2, 5], base: [14, 14, 4, 68], reg: { name: 'Andhra Praja Vedika', short: 'APV', lean: .3, dislikes: ['fiscal'] } },
  { id: 'UT', name: 'Other UTs',        seats: 6,  urban: .60, pos: [4, 5], base: [36, 40, 6, 18], reg: null },
  { id: 'KL', name: 'Kerala',           seats: 20, urban: .48, pos: [1, 6], base: [40, 14, 6, 40], reg: { name: 'Kerala Left Front', short: 'KLF', lean: .35, dislikes: ['market', 'labour', 'land'] } },
  { id: 'TN', name: 'Tamil Nadu',       seats: 39, urban: .48, pos: [2, 6], base: [16, 12, 4, 68], reg: { name: 'Tamizh Makkal Kazhagam', short: 'TMK', lean: .7, dislikes: ['centralise'] } },
];

const RIVALS = {
  A: { name: 'Rashtriya Samruddhi Party', short: 'RSP', color: '#d64541', leader: 'PM Devendra Rathore' },
  B: { name: 'Naya Bharat Morcha',        short: 'NBM', color: '#3b82f6', leader: 'Kavya Iyer' },
};

const PARTY_COLORS = ['#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];
const PARTY_SYMBOLS = ['🦚', '☀️', '🌳', '🪔', '🦁', '⭐'];

const IDEOLOGIES = {
  welfare:  { name: 'Social Welfare', desc: 'Champion of farmers, the poor and workers.', appeal: { farmers: 8, poor: 10, workers: 8, middle: -2, youth: 0, business: -8 } },
  centrist: { name: 'Big-Tent Centrist', desc: 'A little something for everyone.', appeal: { farmers: 4, poor: 4, workers: 3, middle: 3, youth: 3, business: 0 } },
  reform:   { name: 'Pro-Growth Reformer', desc: 'Jobs, markets and aspiration.', appeal: { farmers: -2, poor: 0, workers: 0, middle: 8, youth: 8, business: 10 } },
};

const RIVAL_APPEAL = {
  A: { farmers: -2, poor: 3, workers: -2, middle: 8, youth: 2, business: 10 },
  B: { farmers: 0, poor: 2, workers: 2, middle: 5, youth: 9, business: 0 },
};

const DIFFICULTY = {
  easy:   { name: 'Easy',   baseBonus: 4,  funds: 300, rivalAI: 0.7 },
  normal: { name: 'Normal', baseBonus: 0,  funds: 220, rivalAI: 1.0 },
  hard:   { name: 'Hard',   baseBonus: -3, funds: 160, rivalAI: 1.3 },
};

// Manifesto promises. check(G) decides at the end of a term whether the promise was kept.
const PROMISES = [
  { id: 'loanwaiver', name: 'Forgive farmer loans', blocs: { farmers: 9, poor: 2, business: -3 }, keep: 'Pass the Farm Loan Waiver.', check: G => G.gov.passed.includes('loanwaiver') },
  { id: 'msp',        name: 'Fair crop prices', blocs: { farmers: 10, business: -3, middle: -1 }, keep: 'Pass the MSP Guarantee Act.', check: G => G.gov.passed.includes('msp') },
  { id: 'taxcut',     name: 'Lower taxes', blocs: { middle: 9, youth: 2 }, keep: 'Top income-tax rate at 27% or lower.', check: G => G.eco.b.itr <= 27 },
  { id: 'jobs',       name: 'Lots of new jobs', blocs: { youth: 9, workers: 4 }, keep: 'Unemployment below 6% at term end.', check: G => G.eco.unemp < 6 },
  { id: 'ops',        name: 'Big pensions', blocs: { middle: 5, workers: 4, business: -2 }, keep: 'Restore the Old Pension Scheme.', check: G => G.gov.passed.includes('ops') },
  { id: 'cash',       name: 'Money for mothers', blocs: { poor: 10, middle: 1 }, keep: 'Pass the Mahila Samman cash transfer.', check: G => G.gov.passed.includes('cash') },
  { id: 'health',     name: 'Free hospitals', blocs: { poor: 6, middle: 4 }, keep: 'Pass Universal Health Insurance.', check: G => G.gov.passed.includes('health') },
  { id: 'corptax',    name: 'Help big companies', blocs: { business: 10, workers: -2, poor: -2 }, keep: 'Corporate tax at 22% or lower.', check: G => G.eco.b.ctr <= 22 },
  { id: 'prices',     name: 'Keep prices low', blocs: { middle: 4, poor: 4, workers: 2 }, keep: 'Average inflation under 5% this term.', check: G => avg(G.hist.infl.slice(-20)) < 5 },
  { id: 'infra',      name: 'Great roads', blocs: { business: 4, middle: 3, youth: 2 }, keep: 'Infrastructure spending ≥ 3.6% of GDP.', check: G => G.eco.b.infra >= 3.6 },
  { id: 'lokpal',     name: 'Catch cheaters', blocs: { middle: 3, youth: 3, poor: 1 }, trust: 6, keep: 'Pass the Lokpal Strengthening Act.', check: G => G.gov.passed.includes('lokpal') },
  { id: 'skills',     name: 'Teach every kid a skill', blocs: { youth: 6, workers: 2 }, keep: 'Pass the National Skills Mission.', check: G => G.gov.passed.includes('skills') },
];

// Reforms/bills available as PM.
// pc: political capital. money: money bill (skips Rajya Sabha). tags: what allies may dislike.
// boost: potential growth added over 4 quarters. spend: ongoing %GDP. oneTime: %GDP spread over 4 qtrs.
// rev: ongoing revenue %GDP; revOnce: one-off revenue spread over 4 qtrs. unemp: unemployment target shift.
const REFORMS = [
  { id: 'gst',        name: 'Simple Shop Tax', pc: 3, tags: ['centralise'], blocs: { business: 6, middle: 3 }, boost: .3, rev: -.15, desc: 'Make shop taxes easy and simple.' },
  { id: 'labour',     name: 'Easy Factory Rules', pc: 4, tags: ['labour'], blocs: { business: 9, workers: -11, youth: 2 }, boost: .3, unemp: -.5, risk: 'strike', desc: 'Factories can hire people easily. Workers may not like it.' },
  { id: 'farmmkt',    name: 'Farmers Sell Anywhere', pc: 4, tags: ['farm', 'market'], blocs: { business: 6, farmers: -12 }, boost: .25, risk: 'farmprotest', desc: 'Farmers can sell crops to anyone. Some farmers get scared.' },
  { id: 'msp',        name: 'Fair Crop Prices', pc: 3, tags: ['fiscal'], blocs: { farmers: 14, business: -5, middle: -1 }, spend: .4, infl: .3, desc: 'Promise farmers a fair price for their crops. Costs a lot.' },
  { id: 'loanwaiver', name: 'Forgive Farmer Loans', pc: 2, money: true, tags: ['fiscal'], blocs: { farmers: 12, business: -3, middle: -1 }, oneTime: 1.4, desc: 'Farmers do not have to pay back loans. Very costly!' },
  { id: 'pli',        name: 'Make Phones in India', pc: 2, money: true, tags: [], blocs: { business: 6, workers: 4, youth: 3 }, spend: .2, boost: .3, unemp: -.4, desc: 'Help factories make phones and cars here. More jobs!' },
  { id: 'disinvest',  name: 'Sell Govt Companies', pc: 3, tags: ['market'], blocs: { business: 6, workers: -6 }, boost: .15, revOnce: .8, desc: 'Sell some government companies to get money.' },
  { id: 'bankrecap',  name: 'Fix the Banks', pc: 2, money: true, tags: [], blocs: { business: 4, middle: 1 }, oneTime: .6, boost: .2, flag: 'banksSafe', desc: 'Make banks strong so they do not break.' },
  { id: 'health',     name: 'Free Hospital Care', pc: 3, tags: [], blocs: { poor: 10, middle: 4 }, spend: .5, human: .4, desc: 'Free doctors and hospitals for every family.' },
  { id: 'cash',       name: 'Money for Mothers', pc: 2, money: true, tags: ['fiscal'], blocs: { poor: 12, middle: -1, farmers: 2 }, spend: .9, desc: 'Give money every month to poor mothers.' },
  { id: 'ops',        name: 'Big Pensions', pc: 2, money: true, tags: ['fiscal'], blocs: { middle: 6, workers: 4, business: -4 }, spend: .35, desc: 'Big pensions for old government workers. Costs more every year.' },
  { id: 'itsimple',   name: 'Easy Tax Forms', pc: 2, money: true, tags: [], blocs: { middle: 4, business: 3 }, boost: .1, rev: .1, desc: 'Make tax forms short and easy.' },
  { id: 'green',      name: 'Solar Power', pc: 2, money: true, tags: [], blocs: { youth: 5, business: 2 }, spend: .3, boost: .1, flag: 'green', desc: 'Solar panels everywhere! We need less oil.' },
  { id: 'dpi',        name: 'Pay with Phones', pc: 2, tags: [], blocs: { youth: 4, business: 3, poor: 2 }, boost: .2, flag: 'dpi', desc: 'Help everyone pay and get help using phones.' },
  { id: 'lokpal',     name: 'Catch Cheaters Law', pc: 3, tags: ['anticorruption'], blocs: { middle: 4, youth: 4, poor: 2 }, trust: 10, flag: 'lokpal', desc: 'A strong team to catch leaders who cheat. Some friends get nervous.' },
  { id: 'land',       name: 'Land for Factories', pc: 4, tags: ['land'], blocs: { business: 7, farmers: -9, poor: -2 }, boost: .25, risk: 'farmprotest', desc: 'Make it easy to get land for factories. Farmers may be upset.' },
  { id: 'urbanjobs',  name: 'Jobs in Cities', pc: 3, money: true, tags: ['fiscal'], blocs: { workers: 8, poor: 4, youth: 3 }, spend: .4, unemp: -.6, desc: 'Promise work to everyone in cities.' },
  { id: 'skills',     name: 'Learn a Skill', pc: 2, money: true, tags: [], blocs: { youth: 6, workers: 2 }, spend: .25, human: .25, unemp: -.3, desc: 'Training in every town so young people get good jobs.' },
  { id: 'demo',       name: 'Ban Big Notes', pc: 3, money: true, tags: [], blocs: { middle: -6, poor: -8, business: -7, farmers: -4 }, rev: .3, shock: -2.5, trust: -2, desc: 'Cancel big money notes overnight. Very risky!' },
  { id: 'onoe',       name: 'One Election Day', pc: 5, tags: ['centralise'], blocs: { middle: 2, business: 2 }, trust: -2, flag: 'onoe', desc: 'Hold all elections on the same day.' },
];

const BUDGET_LIMITS = {
  itr:       { name: 'Top income tax',     unit: '%', min: 15, max: 42, step: 1 },
  ctr:       { name: 'Corporate tax',      unit: '%', min: 15, max: 35, step: 1 },
  gst:       { name: 'Average GST',        unit: '%', min: 10, max: 28, step: 1 },
  infra:     { name: 'Infrastructure',     unit: '% GDP', min: 1.5, max: 5.5, step: .1 },
  defence:   { name: 'Defence',            unit: '% GDP', min: 1.2, max: 3.0, step: .1 },
  health:    { name: 'Health',             unit: '% GDP', min: 0.2, max: 2.0, step: .1 },
  education: { name: 'Education',          unit: '% GDP', min: 0.3, max: 2.0, step: .1 },
  welfare:   { name: 'Welfare & Subsidies', unit: '% GDP', min: 0.5, max: 3.5, step: .1 },
  agri:      { name: 'Agriculture',        unit: '% GDP', min: 0.3, max: 2.0, step: .1 },
};

const RATINGS = ['BB+ (Junk)', 'BBB-', 'BBB', 'BBB+', 'A-'];

function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
