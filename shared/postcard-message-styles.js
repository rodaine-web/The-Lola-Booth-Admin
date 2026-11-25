// Bundled, licensed font files are shared by the browser and print renderer.
export const POSTCARD_FONTS = [
 {id:'serif',label:'Classic serif',family:'LolaPostcardSerif',file:'brand/fonts/CormorantGaramond.ttf',size:44},
 {id:'classic',label:'Clean sans-serif',family:'LolaPostcardClassic',file:'assets/keepsakes/fonts/LiberationSans-Regular.ttf',size:40},
 {id:'typewriter',label:'Typewriter · typed',family:'LolaPostcardTypewriter',file:'assets/keepsakes/fonts/SpecialElite-Regular.ttf',size:40},
 {id:'handwritten',label:'Handwritten',family:'LolaPostcardHandwritten',file:'assets/keepsakes/fonts/Caveat.ttf',size:48},
 {id:'casual',label:'Casual handwriting',family:'LolaPostcardCasual',file:'assets/keepsakes/fonts/PatrickHand-Regular.ttf',size:44},
 {id:'script',label:'Elegant handwriting',family:'LolaPostcardScript',file:'brand/fonts/GreatVibes-Regular.ttf',size:48},
];
export const POSTCARD_COLORS = [
 {value:'#26221d',label:'Charcoal'}, {value:'#111111',label:'Black'},
 {value:'#17365d',label:'Navy'}, {value:'#703040',label:'Burgundy'}, {value:'#28543a',label:'Forest green'},
];
export const DEFAULT_MESSAGE_FONT='classic';
export const DEFAULT_MESSAGE_COLOR='#26221d';

// Legacy typewriter remains renderable for historical orders.
export const POSTCARD_EDITOR_FONTS=POSTCARD_FONTS.filter(f=>f.id!=='typewriter');
