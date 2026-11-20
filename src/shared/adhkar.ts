/**
 * Post-salah, morning and evening adhkar for the TV display.
 * Pure data + timing. No Node or DOM. Bundled into the TV app.
 *
 * Window (seconds after iqamah, or adhan + 10 min if iqamah is unset):
 *   0–10 min   prayer in progress (handled by the TV, not here)
 *   10–18 min  post-salah adhkar, every prayer
 *   18–26 min  morning adhkar after Fajr, evening adhkar after Maghrib
 */
import type { PrayerKey } from './display.js';

export interface AdhkarItem {
  arabic: string;
  somali: string;
  note?: string;
}

export interface AdhkarSet {
  key: 'postsalaah' | 'morning' | 'evening';
  title: string;
  titleSo: string;
  items: AdhkarItem[];
}

export const PRAYER_HOLD_SEC = 10 * 60;
export const POST_SEC = 8 * 60;
export const EXTRA_SEC = 8 * 60;

const POST: AdhkarSet = {
  key: 'postsalaah',
  title: 'Adhkar after Salah',
  titleSo: 'Digriga Salaadda Kadib',
  items: [
    {
      arabic: 'أَسْتَغْفِرُ اللَّهَ',
      somali: 'Waxaan dembi dhaaf weydiisanayaa Alle.',
      note: '3 jeer · 3 times',
    },
    {
      arabic:
        'اللَّهُمَّ أَنْتَ السَّلاَمُ وَمِنْكَ السَّلاَمُ، تَبَارَكْتَ يَا ذَا الْجَلاَلِ وَالْإِكْرَامِ',
      somali:
        'Allahayow adiga ayaa ah Nabad, nabaduna adiga ayay kaa timaaddaa; waad barako badantahay Allow leh weynida iyo sharafta.',
    },
    {
      arabic: 'سُبْحَانَ اللَّهِ · الْحَمْدُ لِلَّهِ · اللَّهُ أَكْبَرُ',
      somali: 'Alle ayaa ka nasahan nusqaan, Mahad oo dhan Alle ayaa leh, Alle ayaa ugu weyn.',
      note: '33 jeer mid kasta · 33 times each',
    },
    {
      arabic:
        'لاَ إِلَهَ إِلاَّ اللَّهُ وَحْدَهُ لاَ شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
      somali:
        'Ma jiro ilaah xaq lagu caabudo Alle mooyee, kaligiis ayaa jira oo cid la wadaagtaa ma jirto; isaga ayaa leh boqortooyada, mahad oo dhanna isaga ayaa leh, wax walbana wuu awoodaa.',
    },
    {
      arabic:
        'اللَّهُ لَا إِلَهَ إِلاَّ هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلاَّ بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلاَّ بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ',
      somali: 'Akhri Aayadda Kursiga oo dhammaystiran salaad kasta kadib.',
      note: 'Ayat al-Kursi · Quran 2:255',
    },
  ],
};

const QULS: AdhkarItem = {
  arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ · قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ · قُلْ أَعُوذُ بِرَبِّ النَّاسِ',
  somali: 'Akhri Suuradda Al-Ikhlaas, Al-Falaq iyo An-Naas.',
  note: '3 jeer mid kasta · 3 times each',
};

const SAYYID: AdhkarItem = {
  arabic:
    'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلاَّ أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلاَّ أَنْتَ',
  somali:
    'Allahayow adiga ayaa ah Rabbigayga, ma jiro ilaah xaq lagu caabudo adiga mooyee, adiga ayaa i abuuray aniguna addoonkaaga ayaan ahay.',
  note: 'Sayyid al-Istighfar · mar · once',
};

const MORNING: AdhkarSet = {
  key: 'morning',
  title: 'Morning Adhkar',
  titleSo: 'Digriga Subaxa',
  items: [
    {
      arabic:
        'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لاَ إِلَهَ إِلاَّ اللَّهُ وَحْدَهُ لاَ شَرِيكَ لَهُ',
      somali:
        'Waan waaberiisannay, boqortooyaduna waxay u waaberiisatay Alle; mahad oo dhan Alle ayaa leh, ma jiro ilaah xaq lagu caabudo Alle mooyee, kaligiis ayaa jira oo cid la wadaagtaa ma jirto.',
    },
    {
      arabic:
        'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ وَإِلَيْكَ النُّشُورُ',
      somali:
        'Allahayow adiga ayaan ku waaberiisannay, adiga ayaanna ku galabaysannaa; adiga ayaan ku noolnahay, adiga ayaanna ku dhimanaynaa, xaggaaga ayaana loo soo bixi doonaa.',
    },
    {
      arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْماً نَافِعاً، وَرِزْقاً طَيِّباً، وَعَمَلاً مُتَقَبَّلاً',
      somali:
        'Allahayow waxaan ku weydiisanayaa cilmi anfaca leh, risiq wanaagsan (xalaal ah), iyo camal la aqbalo.',
    },
    QULS,
    SAYYID,
  ],
};

const EVENING: AdhkarSet = {
  key: 'evening',
  title: 'Evening Adhkar',
  titleSo: 'Digriga Galabta',
  items: [
    {
      arabic:
        'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لاَ إِلَهَ إِلاَّ اللَّهُ وَحْدَهُ لاَ شَرِيكَ لَهُ',
      somali:
        'Waan galabaysannay, boqortooyaduna waxay u galabaysatay Alle; mahad oo dhan Alle ayaa leh, ma jiro ilaah xaq lagu caabudo Alle mooyee, kaligiis ayaa jira oo cid la wadaagtaa ma jirto.',
    },
    {
      arabic:
        'اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ وَإِلَيْكَ الْمَصِيرُ',
      somali:
        'Allahayow adiga ayaan ku galabaysannay, adiga ayaanna ku waaberiisannaa; adiga ayaan ku noolnahay, adiga ayaanna ku dhimanaynaa, xaggaaga ayaana loo noqonayaa.',
    },
    {
      arabic:
        'بِسْمِ اللَّهِ الَّذِي لاَ يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلاَ فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
      somali:
        'Magaca Alle ayaan ku bilaabayaa, kaas oo aanay waxba dhibayn magaciisa la jirkiisa wax dhulka jooga iyo wax samada jira midna, waana Maqle wax walba og.',
      note: '3 jeer · 3 times',
    },
    QULS,
    SAYYID,
  ],
};

/** Which set to show, or null outside the adhkar window. */
export function adhkarWindow(prayer: PrayerKey, secondsAfterStart: number): AdhkarSet | null {
  if (secondsAfterStart < PRAYER_HOLD_SEC) return null;
  const t = secondsAfterStart - PRAYER_HOLD_SEC;
  if (t < POST_SEC) return POST;
  if (prayer === 'fajr' && t < POST_SEC + EXTRA_SEC) return MORNING;
  if (prayer === 'maghrib' && t < POST_SEC + EXTRA_SEC) return EVENING;
  return null;
}
