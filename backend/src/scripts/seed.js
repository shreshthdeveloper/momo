import mongoose from 'mongoose';
import { connectDb, disconnectDb, ensureIndexes } from '../config/db.js';
import * as models from '../models/index.js';
import {
  User,
  Category,
  Topic,
  Question,
  ensurePublicSpace,
  publicSpaceId,
} from '../models/index.js';
import { loadProgression } from '../services/progressionService.js';
import { ensureMonthlyChests } from '../services/chestService.js';
import { ACHIEVEMENTS } from '../shared/achievements.js';
import { contentHashOf } from '../lib/crypto.js';
import { istDateKey } from '../lib/dates.js';
import { QUESTION_STATUS, TOPIC_STATUS, RANKED_START } from '../shared/constants.js';

/**
 * The seed. One file, and the only one in this directory.
 *
 *   npm run seed
 *
 * It is DESTRUCTIVE by design: every collection is emptied before anything is
 * written. The old seed upserted by natural key, which sounds safer and was in
 * practice worse — renaming a topic or dropping a question left the previous
 * one behind, so the database slowly filled with content no version of the seed
 * had ever intended, and no two machines matched. Wiping first means the result
 * is a pure function of this file.
 *
 * What it produces, and nothing else:
 *   1 superadmin
 *   1 demo player, levelled to the top of the ladder
 *   10 categories, each carrying a drawn subject glyph rather than a photograph
 *   14 topics, 22+ published questions each (MIN_PUBLISHED_QUESTIONS_TO_LIVE is
 *     21 — a topic under it never goes live, and a catalogue of unplayable
 *     topics demonstrates nothing)
 *
 * Topics are here because they are not optional: a Question hangs off a Topic
 * and nothing else, so a catalogue of categories and questions with no topics
 * between them is a catalogue nobody can play.
 *
 * Deliberately absent: an organization and a simulated match history.
 * Fabricated opponents and invented ratings make the leaderboards and the ghost
 * pool look populated when they are not, which hides exactly the behaviour
 * worth testing — what the product does on an empty database.
 *
 * The ONE exception is the demo player, and it earns its place: the catalogue
 * is 150 avatars and 50 banners deep and a fresh account owns two of them, so
 * every shelf past the starter pair is a priced tile nobody can afford. There
 * was no way to look at the thing that had just been built without playing
 * several hundred matches. One account does not populate a leaderboard (it is
 * one row) and cannot become a ghost (ghosts come from replays, which this file
 * does not write), so the objection above does not reach it.
 *
 * Sign in as either account with OTP 000000.
 */

// ── The one account ────────────────────────────────────────────────────────

const SUPERADMIN = { phone: '+919000000001', displayName: 'Mimo Ops', avatar: 'robot' };

/**
 * The demo player: the top of the level ladder, Diamond, and rich.
 *
 * The XP figure is the last row of the shipped account curve — the config is
 * seeded from that same curve, so this is "the top of the ladder" rather than a
 * number that happens to be big today and short tomorrow. The balance is the
 * same idea: enough to buy several of anything, so the shop can be USED rather
 * than only looked at.
 *
 * It owns the whole catalogue outright rather than being levelled into it,
 * because after coins-and-cosmetics.md a level unlocks nothing wearable — only
 * a purchase or a chest does, and a demo account that has to shop first is a
 * demo account that shows an empty wardrobe.
 */
const DEMO_PLAYER = {
  phone: '+919000000002',
  displayName: 'Demo Player',
  avatar: 'ninja',
  banner: 'midnight-peaks',
  title: 'immortal',
  /** Diamond — high enough to have earned both monthly chests. */
  rankedRating: 1720,
  coins: 250_000,
  /** A seven-day streak, so the streak tile and its achievement both read. */
  streak: { current: 9, longest: 14 },
};

/**
 * The seven subjects.
 *
 * `icon` is the wire key the client resolves — it is written into the
 * category's `iconUrl` and into every one of its topics' `coverUrl` as
 * `mimo:icon/<key>`, exactly the way an avatar preset is carried. That is why
 * no payload had to learn a new field to render these.
 *
 * Stock photography is deliberately gone. It was never about the subject (the
 * Python topic wore a picture of an Arduino board), half the catalogue had no
 * photo at all and fell back to a letter in a coloured box, and a grid mixing
 * the two has no visual system holding it together.
 */
const CATEGORIES = [
  { name: 'Programming', icon: 'programming', color: '#4CA9E8' },
  { name: 'Mathematics', icon: 'mathematics', color: '#9B8CF5' },
  { name: 'Entertainment', icon: 'entertainment', color: '#F2789F' },
  { name: 'Science', icon: 'science', color: '#48C99B' },
  { name: 'Sports', icon: 'sports', color: '#F5B62E' },
  { name: 'History', icon: 'history', color: '#E0A46A' },
  { name: 'General Knowledge', icon: 'general', color: '#5FC9D6' },
  { name: 'Harry Potter', icon: 'fantasy', color: '#9B7BE8' },
  { name: 'Marvel', icon: 'comics', color: '#E0554F' },
  { name: 'Mythology', icon: 'mythology', color: '#F0A93B' },
];

// ── Question banks ─────────────────────────────────────────────────────────
// [text, options, correctIndex, difficulty, explanation, art?]
//
// `art` is the sixth element and it is optional: a key from the client's own
// drawn set (mobile/src/components/QuestionArt.jsx), written to the question as
// `mimo:art/<key>`. That is the same wire scheme a topic cover uses, and the
// same reason: the catalogue ships no binaries, so a question can ask "which
// emblem is this?" without the seed carrying a single trademarked image. An
// admin who uploads a real photograph through the question editor stores an
// ordinary URL in the same field, and both render through one component.

const PYTHON = [
  ['Which function writes text to the screen in Python?', ['print()', 'echo()', 'printf()', 'write()'], 0, 'easy', 'print() sends its arguments to standard output.'],
  ['What does len("mimo") return?', ['3', '5', '4', 'An error'], 2, 'easy', 'len() counts the characters: m-i-m-o is 4.'],
  ['Which symbol starts a single-line comment?', ['//', '#', '/*', '--'], 1, 'easy', 'Everything after # on a line is ignored by the interpreter.'],
  ['Which keyword defines a function?', ['func', 'define', 'fn', 'def'], 3, 'easy', 'Functions are declared with def, as in def greet():.'],
  ['What type is the value True?', ['str', 'int', 'bool', 'float'], 2, 'easy', 'True and False are the two values of the bool type.'],
  ['What is the index of the first item in a Python list?', ['1', '0', '-1', 'first'], 1, 'easy', 'Python sequences are zero-indexed, so the first item is at index 0.'],
  ['What does "py" + "thon" evaluate to?', ['python', 'py thon', 'pythonthon', 'A TypeError'], 0, 'easy', 'The + operator concatenates two strings with nothing in between.'],
  ['Which brackets create a list literal?', ['( )', '{ }', '[ ]', '< >'], 2, 'easy', 'Square brackets build a list; braces build a dict or set.'],
  ['What is the result of 7 // 2?', ['3.5', '3', '4', '2'], 1, 'medium', '// is floor division: it divides and drops the fractional part.'],
  ['What is the result of 10 % 3?', ['0', '3', '1', '0.33'], 2, 'medium', '% gives the remainder: 10 = 3 × 3 with 1 left over.'],
  ['What does "hello"[1:4] return?', ['hel', 'ello', 'llo', 'ell'], 3, 'medium', 'Slices include the start index (1) and stop before the end index (4).'],
  ['What does list(range(3)) produce?', ['[1, 2, 3]', '[0, 1, 2]', '[0, 1, 2, 3]', '[3]'], 1, 'medium', 'range(3) counts from 0 up to but not including 3.'],
  ['What does [x * x for x in range(4)] produce?', ['[0, 1, 4, 9]', '[1, 4, 9, 16]', '[0, 1, 2, 3]', '[1, 2, 4, 8]'], 0, 'medium', 'The comprehension squares each of 0, 1, 2 and 3.'],
  ['What error does 1 / 0 raise?', ['ValueError', 'ZeroDivisionError', 'TypeError', 'NameError'], 1, 'medium', 'Dividing by zero raises ZeroDivisionError.'],
  ['Which standard-library module provides sqrt() and pi?', ['numpy', 'stats', 'random', 'math'], 3, 'medium', 'The math module ships with Python; numpy is a third-party package.'],
  ['What does bool("") evaluate to?', ['True', 'False', 'None', 'An error'], 1, 'medium', 'Empty strings are falsy, so bool("") is False.'],
  ['What does {1, 2, 2, 3} evaluate to?', ['{1, 2, 2, 3}', '{1, 2, 3}', '[1, 2, 3]', 'An error'], 1, 'medium', 'Braces with values build a set, and sets discard duplicates.'],
  ['What does "python"[::-1] return?', ['nohtyp', 'python', 'pytho', 'An IndexError'], 0, 'hard', 'A step of -1 walks the string backwards, reversing it.'],
  ['What does d.get("x") return if key "x" is missing from dict d?', ['A KeyError is raised', '0', 'False', 'None'], 3, 'hard', 'get() returns None (or a supplied default) instead of raising.'],
  ['In def f(*args), what does args hold inside the function?', ['A tuple of extra positional args', 'A list of keyword arguments', 'A dict of all arguments', 'Only the first argument'], 0, 'hard', 'A *parameter collects surplus positional arguments into a tuple.'],
  ['What does sorted("bca") return?', ["['a', 'b', 'c']", 'abc', "['b', 'c', 'a']", 'A TypeError'], 0, 'hard', 'sorted() accepts any iterable and always returns a new list.'],
  ['What is the output of print(0.1 + 0.2 == 0.3)?', ['True', 'False', '0.3', 'A SyntaxError'], 1, 'hard', 'Binary floats are inexact: 0.1 + 0.2 is 0.30000000000000004.'],
];

const MYSQL = [
  ['Which SQL keyword retrieves rows from a table?', ['SELECT', 'GET', 'FETCH ALL', 'OPEN'], 0, 'easy', 'SELECT is the statement that reads data from tables.'],
  ['Which clause filters individual rows before any grouping?', ['HAVING', 'WHERE', 'FILTER', 'IF'], 1, 'easy', 'WHERE filters rows; HAVING filters groups after GROUP BY.'],
  ['Which statement adds a new row to a table?', ['INSERT INTO', 'ADD ROW', 'APPEND', 'CREATE ROW'], 0, 'easy', 'INSERT INTO table (...) VALUES (...) writes a new row.'],
  ['Which keyword removes duplicate rows from a result?', ['UNIQUE', 'DEDUPE', 'DISTINCT', 'SINGLE'], 2, 'easy', 'SELECT DISTINCT returns each distinct row once.'],
  ['Which clause sorts the rows of a result set?', ['SORT BY', 'ORDER BY', 'GROUP BY', 'RANK BY'], 1, 'easy', 'ORDER BY sorts the result, ascending by default.'],
  ['What does COUNT(*) return?', ['The number of rows', 'The number of columns', 'The largest value', 'The table size in bytes'], 0, 'easy', 'COUNT(*) counts every row the query matches.'],
  ['Which data type stores whole numbers in MySQL?', ['VARCHAR', 'TEXT', 'DATE', 'INT'], 3, 'easy', 'INT holds whole numbers; VARCHAR and TEXT hold strings.'],
  ['Which statement removes an entire table, structure and all?', ['DELETE TABLE', 'DROP TABLE', 'TRUNCATE ROWS', 'REMOVE TABLE'], 1, 'easy', 'DROP TABLE deletes the table itself, not just its rows.'],
  ['Which JOIN returns only rows with a match in BOTH tables?', ['INNER JOIN', 'LEFT JOIN', 'OUTER JOIN', 'CROSS JOIN'], 0, 'medium', 'INNER JOIN keeps only the rows where the join condition matches.'],
  ['What does a LEFT JOIN return?', ['Only rows matching in both tables', 'All left rows plus matched right rows', 'All right rows only', 'Rows from neither table'], 1, 'medium', 'Left rows always appear; unmatched right columns come back NULL.'],
  ['Which clause filters the groups created by GROUP BY?', ['WHERE', 'ORDER BY', 'HAVING', 'LIMIT'], 2, 'medium', 'HAVING applies a condition to each group after aggregation.'],
  ['What does a PRIMARY KEY guarantee for its column?', ['Unique, non-null values', 'Values are auto-generated', 'Values are encrypted', 'Values may repeat'], 0, 'medium', 'A primary key uniquely identifies each row and can never be NULL.'],
  ['Which keyword caps the number of rows MySQL returns?', ['TOP', 'ROWNUM', 'FIRST', 'LIMIT'], 3, 'medium', 'LIMIT n returns at most n rows; TOP and ROWNUM belong to other databases.'],
  ['Which function returns the current date and time in MySQL?', ['NOW()', 'GETDATE()', 'TODAY()', 'CLOCK()'], 0, 'medium', 'NOW() (like CURRENT_TIMESTAMP) gives the current date and time.'],
  ['What does a FOREIGN KEY enforce?', ['Uniqueness in its own table', 'A link to a key in another table', 'Automatic indexing of all columns', 'Case-sensitive comparisons'], 1, 'medium', 'A foreign key must match a referenced key value in the parent table.'],
  ['Which LIKE wildcard matches any sequence of characters?', ['_', '*', '%', '?'], 2, 'medium', '% matches any run of characters; _ matches exactly one.'],
  ['What does GROUP BY do?', ['Sorts rows alphabetically', 'Removes NULL values', 'Joins two tables', 'Groups rows that share a value'], 3, 'medium', 'GROUP BY collapses rows with equal values so aggregates apply per group.'],
  ['Why add an index to a column?', ['To speed up lookups on that column', 'To compress the table', 'To enforce foreign keys', 'To keep rows in insertion order'], 0, 'hard', 'An index lets MySQL find matching rows without scanning the whole table.'],
  ['What is the result of the comparison NULL = NULL?', ['TRUE', 'NULL', 'FALSE', '1'], 1, 'hard', 'Any comparison with NULL is unknown — use IS NULL to test for it.'],
  ['Which storage engine has been MySQL’s default since 5.5?', ['MyISAM', 'Memory', 'InnoDB', 'Archive'], 2, 'hard', 'InnoDB replaced MyISAM as the default, adding transactions and row locks.'],
  ['How does CHAR(10) differ from VARCHAR(10)?', ['CHAR pads to a fixed length', 'CHAR stores only numbers', 'CHAR allows longer strings', 'CHAR is always case-sensitive'], 0, 'hard', 'CHAR always stores exactly 10 characters, space-padded; VARCHAR stores only what you insert.'],
  ['What does a UNIQUE constraint allow that a PRIMARY KEY does not?', ['NULL values', 'Duplicate values', 'Faster queries', 'Multiple data types'], 0, 'hard', 'A UNIQUE column may contain NULLs; a primary key can never be NULL.'],
];

const BASIC_MATHS = [
  ['What is 7 × 8?', ['56', '54', '64', '48'], 0, 'easy', '7 × 8 = 56.'],
  ['What is 144 ÷ 12?', ['14', '12', '10', '16'], 1, 'easy', '12 × 12 = 144, so 144 ÷ 12 = 12.'],
  ['What is the square root of 225?', ['25', '35', '15', '5'], 2, 'easy', '15 × 15 = 225.'],
  ['Which fraction equals 0.75?', ['2/3', '4/5', '7/10', '3/4'], 3, 'easy', '3 ÷ 4 = 0.75.'],
  ['What is 1000 − 437?', ['563', '567', '553', '573'], 0, 'easy', '437 + 563 = 1000.'],
  ['What is 15% of 200?', ['20', '30', '25', '35'], 1, 'easy', '10% is 20 and 5% is 10, so 15% is 30.'],
  ['What is 2⁵?', ['16', '30', '32', '64'], 2, 'easy', 'Doubling five times: 2, 4, 8, 16, 32.'],
  ['If x + 7 = 15, what is x?', ['9', '7', '6', '8'], 3, 'easy', 'Subtract 7 from both sides: x = 15 − 7 = 8.'],
  ['What is 9 + 6 × 2?', ['21', '30', '24', '27'], 0, 'medium', 'Multiplication comes first: 9 + 12 = 21.'],
  ['What is the LCM of 6 and 8?', ['48', '24', '12', '16'], 1, 'medium', 'Multiples of 8: 8, 16, 24 — and 24 is also a multiple of 6.'],
  ['What is the HCF of 18 and 24?', ['3', '12', '6', '9'], 2, 'medium', '6 divides both 18 and 24, and no larger number does.'],
  ['A train covers 240 km in 3 hours. What is its average speed?', ['70 km/h', '90 km/h', '75 km/h', '80 km/h'], 3, 'medium', 'Speed = distance ÷ time = 240 ÷ 3 = 80 km/h.'],
  ['What is 0.2 × 0.3?', ['0.06', '0.6', '0.006', '6'], 0, 'medium', '2 × 3 = 6, with two decimal places in the factors: 0.06.'],
  ['What is 3/5 as a percentage?', ['65%', '60%', '55%', '35%'], 1, 'medium', '3 ÷ 5 = 0.6, which is 60%.'],
  ['What is the average of 4, 8 and 12?', ['9', '10', '8', '6'], 2, 'medium', '(4 + 8 + 12) ÷ 3 = 24 ÷ 3 = 8.'],
  ['A number doubled and increased by 3 gives 19. What is the number?', ['6', '9', '7', '8'], 3, 'medium', '2n + 3 = 19, so 2n = 16 and n = 8.'],
  ['A shirt costs ₹800 after a 20% discount. What was the original price?', ['₹1000', '₹960', '₹1200', '₹900'], 0, 'medium', '80% of the original is 800, so the original is 800 ÷ 0.8 = 1000.'],
  ['Which of these numbers is prime?', ['87', '91', '97', '93'], 2, 'hard', '87 = 3 × 29, 91 = 7 × 13, 93 = 3 × 31; 97 has no factors.'],
  ['A recipe for 4 people needs 300 g of rice. How much for 10 people?', ['600 g', '750 g', '700 g', '800 g'], 1, 'hard', '300 ÷ 4 = 75 g per person, and 75 × 10 = 750 g.'],
  ['What is 25% of 25% of 400?', ['25', '100', '50', '12.5'], 0, 'hard', '25% of 400 is 100, and 25% of 100 is 25.'],
  ['If 5 workers finish a job in 12 days, how long do 6 workers take?', ['9 days', '11 days', '10 days', '12 days'], 2, 'hard', 'The job is 5 × 12 = 60 worker-days, and 60 ÷ 6 = 10.'],
  ['The sum of three consecutive integers is 72. What is the largest?', ['23', '24', '25', '26'], 2, 'hard', 'The middle number is 72 ÷ 3 = 24, so the largest is 25.'],
];

const ROMAN_NUMBERS = [
  ['What is IV in numbers?', ['4', '6', '5', '9'], 0, 'easy', 'I before V subtracts one: 5 − 1 = 4.'],
  ['What is IX in numbers?', ['11', '9', '10', '19'], 1, 'easy', 'I before X subtracts one: 10 − 1 = 9.'],
  ['What is XII in numbers?', ['7', '14', '12', '17'], 2, 'easy', 'X + II = 10 + 2 = 12.'],
  ['Which numeral means 50?', ['C', 'D', 'X', 'L'], 3, 'easy', 'L is 50; C is 100 and D is 500.'],
  ['Which numeral means 100?', ['C', 'L', 'D', 'M'], 0, 'easy', 'C stands for 100, from the Latin centum.'],
  ['Which numeral means 500?', ['C', 'D', 'M', 'L'], 1, 'easy', 'D is 500 — halfway to M, which is 1000.'],
  ['Which numeral means 1000?', ['D', 'C', 'M', 'X'], 2, 'easy', 'M stands for 1000, from the Latin mille.'],
  ['What is 18 in Roman numerals?', ['XIX', 'IIXX', 'XVII', 'XVIII'], 3, 'easy', '10 + 5 + 3 = XVIII; XIX would be 19.'],
  ['What is XL in numbers?', ['60', '90', '50', '40'], 3, 'medium', 'X before L subtracts ten: 50 − 10 = 40.'],
  ['What is XC in numbers?', ['90', '110', '40', '60'], 0, 'medium', 'X before C subtracts ten: 100 − 10 = 90.'],
  ['What is CD in numbers?', ['600', '400', '900', '450'], 1, 'medium', 'C before D subtracts one hundred: 500 − 100 = 400.'],
  ['What is CM in numbers?', ['400', '600', '900', '1100'], 2, 'medium', 'C before M subtracts one hundred: 1000 − 100 = 900.'],
  ['What is 44 in Roman numerals?', ['XLIV', 'XLIIII', 'IVXL', 'XLVI'], 0, 'medium', '44 = 40 + 4 = XL + IV.'],
  ['What is 99 in Roman numerals?', ['IC', 'XCIX', 'LXXXXIX', 'CIX'], 1, 'medium', '99 = XC (90) + IX (9); IC is not a valid form.'],
  ['What is LXXX in numbers?', ['70', '80', '130', '30'], 1, 'medium', 'L + XXX = 50 + 30 = 80.'],
  ['What is 2026 in Roman numerals?', ['MMVI', 'MMXVI', 'MXXVI', 'MMXXVI'], 3, 'medium', 'MM (2000) + XX (20) + VI (6) = MMXXVI.'],
  ['What is DCCC in numbers?', ['600', '700', '1300', '800'], 3, 'medium', 'D + CCC = 500 + 300 = 800.'],
  ['What is MCMXCIX in numbers?', ['2199', '1999', '1899', '1989'], 1, 'hard', 'M + CM (900) + XC (90) + IX (9) = 1999.'],
  ['Which of these is NOT a valid Roman numeral?', ['XIV', 'VX', 'XLII', 'MMXX'], 1, 'hard', 'V is never subtracted — 5 is simply V, so VX is invalid.'],
  ['What is LVI + IV, written in Roman numerals?', ['LIX', 'LX', 'LXIV', 'LVIII'], 1, 'hard', '56 + 4 = 60, which is LX.'],
  ['What is CDXLIV in numbers?', ['444', '446', '644', '456'], 0, 'hard', 'CD (400) + XL (40) + IV (4) = 444.'],
  ['Which rule explains IV, IX, XL and CM?', ['Smaller before larger subtracts', 'Symbols always add left to right', 'V and L may repeat twice', 'M can only appear once'], 0, 'hard', 'Subtractive notation: I, X or C before a larger numeral is subtracted from it.'],
];

const INDIAN_ACTORS = [
  ['Who is known as the "Big B" of Bollywood?', ['Amitabh Bachchan', 'Shah Rukh Khan', 'Salman Khan', 'Dharmendra'], 0, 'easy', 'Amitabh Bachchan has carried the Big B nickname for decades.'],
  ['Which actor is nicknamed "King Khan"?', ['Aamir Khan', 'Shah Rukh Khan', 'Salman Khan', 'Saif Ali Khan'], 1, 'easy', 'Shah Rukh Khan is popularly called King Khan.'],
  ['Rajinikanth is a superstar of cinema in which language?', ['Telugu', 'Malayalam', 'Tamil', 'Kannada'], 2, 'easy', 'Rajinikanth built his legend in Tamil cinema.'],
  ['Which actor played Bhuvan in the 2001 film Lagaan?', ['Shah Rukh Khan', 'Hrithik Roshan', 'Ajay Devgn', 'Aamir Khan'], 3, 'easy', 'Aamir Khan led Lagaan as the villager Bhuvan.'],
  ['Who played Gabbar Singh in Sholay?', ['Amjad Khan', 'Amrish Puri', 'Pran', 'Prem Chopra'], 0, 'easy', 'Amjad Khan’s Gabbar Singh became Hindi cinema’s most famous villain.'],
  ['Aamir Khan is often called Bollywood’s…?', ['King of Romance', 'Mr. Perfectionist', 'Tragedy King', 'Action King'], 1, 'easy', 'His meticulous approach to roles earned Aamir the Mr. Perfectionist tag.'],
  ['Who is known as the "Tragedy King" of Hindi cinema?', ['Raj Kapoor', 'Dev Anand', 'Dilip Kumar', 'Guru Dutt'], 2, 'easy', 'Dilip Kumar earned the title through his intense tragic roles.'],
  ['Which actress played Mastani in Bajirao Mastani (2015)?', ['Priyanka Chopra', 'Kareena Kapoor', 'Katrina Kaif', 'Deepika Padukone'], 3, 'easy', 'Deepika Padukone played Mastani; Priyanka Chopra played Kashibai.'],
  ['Deepika Padukone made her Bollywood debut in which film?', ['Om Shanti Om', 'Chennai Express', 'Ra.One', 'Cocktail'], 0, 'medium', 'She debuted opposite Shah Rukh Khan in Om Shanti Om (2007).'],
  ['In which film did Shah Rukh Khan play Raj Malhotra?', ['Kuch Kuch Hota Hai', 'Dilwale Dulhania Le Jayenge', 'Dil To Pagal Hai', 'Baazigar'], 1, 'medium', 'Raj Malhotra is his DDLJ character; in Kuch Kuch Hota Hai he was Rahul.'],
  ['Amitabh Bachchan won the National Best Actor award for which 1990 film?', ['Hum', 'Shahenshah', 'Agneepath', 'Khuda Gawah'], 2, 'medium', 'His Vijay Dinanath Chauhan in Agneepath won the National Film Award.'],
  ['Rajinikanth played the title role in which 2010 sci-fi blockbuster?', ['Sivaji', 'Kabali', 'Lingaa', 'Enthiran (Robot)'], 3, 'medium', 'Enthiran cast Rajinikanth as both the scientist and the robot Chitti.'],
  ['Which actor portrayed wrestler Mahavir Singh Phogat in Dangal?', ['Aamir Khan', 'Akshay Kumar', 'Salman Khan', 'Ajay Devgn'], 0, 'medium', 'Aamir Khan played the father who trains his daughters to wrestle.'],
  ['Priyanka Chopra won which pageant title in 2000?', ['Miss Universe', 'Miss World', 'Miss Earth', 'Miss International'], 1, 'medium', 'Priyanka Chopra was crowned Miss World 2000; Lara Dutta won Miss Universe.'],
  ['Which actor starred as Munna Bhai in the Munna Bhai films?', ['Arshad Warsi', 'Anil Kapoor', 'Sanjay Dutt', 'Sunil Shetty'], 2, 'medium', 'Sanjay Dutt played Munna Bhai, with Arshad Warsi as Circuit.'],
  ['Hema Malini is famously known by which nickname?', ['Queen Bee', 'Lady Superstar', 'Golden Girl', 'Dream Girl'], 3, 'medium', 'Her 1977 film Dream Girl cemented the nickname.'],
  ['Who played Devdas in Sanjay Leela Bhansali’s 2002 film?', ['Shah Rukh Khan', 'Salman Khan', 'Abhishek Bachchan', 'Hrithik Roshan'], 0, 'medium', 'Shah Rukh Khan starred as Devdas opposite Aishwarya Rai and Madhuri Dixit.'],
  ['Amitabh Bachchan made his acting debut in which 1969 film?', ['Zanjeer', 'Saat Hindustani', 'Anand', 'Deewaar'], 1, 'hard', 'Saat Hindustani (1969) was his first film; Zanjeer came in 1973.'],
  ['Who won the first-ever Filmfare Best Actress award?', ['Nargis', 'Madhubala', 'Meena Kumari', 'Suraiya'], 2, 'hard', 'Meena Kumari won at the first Filmfare Awards (1954) for Baiju Bawra.'],
  ['Shah Rukh Khan made his film debut in which 1992 movie?', ['Deewana', 'Baazigar', 'Darr', 'Raju Ban Gaya Gentleman'], 0, 'hard', 'Deewana (1992) introduced him; Baazigar and Darr followed in 1993.'],
  ['What is Rajinikanth’s birth name?', ['Yusuf Khan', 'Rama Rao Nandamuri', 'Ganesan Villupuram', 'Shivaji Rao Gaekwad'], 3, 'hard', 'He was born Shivaji Rao Gaekwad; Yusuf Khan was Dilip Kumar’s birth name.'],
  ['Who received the first Dadasaheb Phalke Award in 1969?', ['Devika Rani', 'Prithviraj Kapoor', 'Ashok Kumar', 'Raj Kapoor'], 0, 'hard', 'Actress Devika Rani, first lady of Indian cinema, was the first recipient.'],
];

const INDIAN_MOVIES = [
  ['Who directed the 1975 classic Sholay?', ['Yash Chopra', 'Ramesh Sippy', 'Raj Kapoor', 'Manmohan Desai'], 1, 'easy', 'Ramesh Sippy directed Sholay, written by Salim–Javed.'],
  ['In which year was Dilwale Dulhania Le Jayenge released?', ['1993', '1997', '1995', '1999'], 2, 'easy', 'DDLJ, with Shah Rukh Khan and Kajol, released in 1995.'],
  ['Who directed 3 Idiots?', ['Rajkumar Hirani', 'Karan Johar', 'Farhan Akhtar', 'Imtiaz Ali'], 0, 'easy', 'Rajkumar Hirani directed 3 Idiots (2009), based on Chetan Bhagat’s novel.'],
  ['Dangal (2016) is about which sport?', ['Boxing', 'Kabaddi', 'Hockey', 'Wrestling'], 3, 'easy', 'Dangal follows the Phogat sisters’ rise in wrestling.'],
  ['Baahubali was primarily made in which language?', ['Telugu', 'Tamil', 'Hindi', 'Kannada'], 0, 'easy', 'Baahubali is a Telugu film, shot simultaneously in Tamil and dubbed widely.'],
  ['Lagaan builds to a match of which game?', ['Hockey', 'Cricket', 'Polo', 'Football'], 1, 'easy', 'The villagers stake their land tax on a cricket match against the British.'],
  ['Which film features the friends Jai and Veeru?', ['Deewaar', 'Zanjeer', 'Sholay', 'Don'], 2, 'easy', 'Jai and Veeru, played by Amitabh Bachchan and Dharmendra, lead Sholay.'],
  ['"Mogambo khush hua" is a famous line from which film?', ['Mr. India', 'Shahenshah', 'Karma', 'Tridev'], 0, 'easy', 'Amrish Puri’s Mogambo delivers the line in Mr. India (1987).'],
  ['Who directed Baahubali: The Beginning?', ['Shankar', 'S.S. Rajamouli', 'Trivikram Srinivas', 'Sukumar'], 1, 'medium', 'S.S. Rajamouli directed both Baahubali films.'],
  ['Lagaan is set in which period?', ['The British colonial era', 'The Mughal era', 'Post-independence India', 'The Maratha empire'], 0, 'medium', 'Lagaan takes place in the village of Champaner in 1893, under British rule.'],
  ['Which film won the Best Original Song Oscar for "Naatu Naatu"?', ['Baahubali 2', 'KGF: Chapter 2', 'RRR', 'Pushpa'], 2, 'medium', '"Naatu Naatu" from RRR won the Academy Award in 2023.'],
  ['Who directed Mughal-e-Azam (1960)?', ['Mehboob Khan', 'Bimal Roy', 'Guru Dutt', 'K. Asif'], 3, 'medium', 'K. Asif spent over a decade making Mughal-e-Azam.'],
  ['Which 2001 film earned an Oscar nomination for Best Foreign Language Film?', ['Lagaan', 'Devdas', 'Swades', 'Rang De Basanti'], 0, 'medium', 'Lagaan was nominated at the 74th Academy Awards.'],
  ['In 3 Idiots, Rancho’s two close friends are Farhan and…?', ['Chatur', 'Raju', 'Joy', 'Suhas'], 1, 'medium', 'Farhan and Raju are Rancho’s hostel roommates; Chatur is their rival.'],
  ['In Sholay, Gabbar Singh terrorises which village?', ['Champaner', 'Wasseypur', 'Ramgarh', 'Malgudi'], 2, 'medium', 'Thakur hires Jai and Veeru to defend Ramgarh from Gabbar.'],
  ['Where do Raj and Simran first meet in DDLJ?', ['In a Punjab village', 'In a Mumbai college', 'At a London wedding', 'On a train trip across Europe'], 3, 'medium', 'They meet on a Eurail holiday before the story moves to Punjab.'],
  ['Who composed the music for Lagaan?', ['A.R. Rahman', 'Anu Malik', 'Jatin–Lalit', 'Ismail Darbar'], 0, 'medium', 'A.R. Rahman scored Lagaan, including "Mitwa" and "O Rey Chhori".'],
  ['Which was India’s first full-length feature film (1913)?', ['Alam Ara', 'Raja Harishchandra', 'Kisan Kanya', 'Devdas'], 1, 'hard', 'Dadasaheb Phalke’s Raja Harishchandra (1913) was India’s first feature.'],
  ['Alam Ara (1931) is remembered as India’s first…?', ['Colour film', 'Silent film', 'Sound film (talkie)', '3D film'], 2, 'hard', 'Alam Ara was the first Indian film with synchronised sound.'],
  ['Which film ran for over 20 years at Mumbai’s Maratha Mandir?', ['Dilwale Dulhania Le Jayenge', 'Sholay', 'Hum Aapke Hain Koun', 'Mughal-e-Azam'], 0, 'hard', 'DDLJ’s record run at Maratha Mandir crossed two decades of daily shows.'],
  ['Pather Panchali (1955) is the first film of which trilogy?', ['The Calcutta Trilogy', 'The Apu Trilogy', 'The Bengal Trilogy', 'The River Trilogy'], 1, 'hard', 'Satyajit Ray followed it with Aparajito and Apur Sansar.'],
  ['Which film earned India’s first Oscar nomination for Best Foreign Film?', ['Pather Panchali', 'Salaam Bombay!', 'Lagaan', 'Mother India'], 3, 'hard', 'Mother India (1957) was nominated, losing by a single vote.'],
];

const SCIENCE = [
  ['Which gas do plants absorb from the air to make food?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], 1, 'easy', 'Photosynthesis takes in carbon dioxide and releases oxygen.'],
  ['How many bones are there in an adult human body?', ['186', '206', '226', '246'], 1, 'easy', 'A newborn has about 270; some fuse, leaving 206 in an adult.'],
  ['What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2, 'easy', 'From the Latin aurum. Ag is silver.'],
  ['Which planet is closest to the Sun?', ['Venus', 'Mercury', 'Earth', 'Mars'], 1, 'easy', 'Mercury orbits at about 58 million kilometres.'],
  ['What force keeps planets in orbit around the Sun?', ['Magnetism', 'Friction', 'Gravity', 'Tension'], 2, 'easy', 'Gravity between the Sun and each planet curves its path into an orbit.'],
  ['Which organ pumps blood around the body?', ['Liver', 'Lungs', 'Kidney', 'Heart'], 3, 'easy', 'The heart pushes blood through the circulatory system.'],
  ['What is the most abundant gas in Earth’s atmosphere?', ['Oxygen', 'Nitrogen', 'Argon', 'Carbon dioxide'], 1, 'easy', 'Nitrogen makes up roughly 78% of the air.'],
  ['At what temperature does water boil at sea level?', ['90 °C', '100 °C', '110 °C', '120 °C'], 1, 'easy', 'At standard atmospheric pressure, water boils at 100 °C.'],
  ['Which blood cells carry oxygen?', ['White cells', 'Platelets', 'Red cells', 'Plasma'], 2, 'easy', 'Haemoglobin in red cells binds oxygen in the lungs.'],
  ['What is H2O more commonly called?', ['Salt', 'Water', 'Acid', 'Sugar'], 1, 'easy', 'Two hydrogen atoms bonded to one oxygen atom.'],
  ['Which scientist proposed the three laws of motion?', ['Einstein', 'Newton', 'Galileo', 'Bohr'], 1, 'medium', 'Newton published them in the Principia in 1687.'],
  ['What part of the plant conducts photosynthesis?', ['Root', 'Stem', 'Leaf', 'Flower'], 2, 'medium', 'Leaves hold the chloroplasts where photosynthesis happens.'],
  ['Which particle carries a negative charge?', ['Proton', 'Neutron', 'Electron', 'Positron'], 2, 'medium', 'Electrons orbit the nucleus and carry a negative charge.'],
  ['What is the powerhouse of the cell?', ['Nucleus', 'Ribosome', 'Mitochondrion', 'Vacuole'], 2, 'medium', 'Mitochondria produce most of the cell’s ATP.'],
  ['Which vitamin does sunlight help the body produce?', ['Vitamin A', 'Vitamin B12', 'Vitamin C', 'Vitamin D'], 3, 'medium', 'Skin synthesises vitamin D from UVB light.'],
  ['What is the hardest naturally occurring substance?', ['Quartz', 'Diamond', 'Steel', 'Granite'], 1, 'medium', 'Diamond sits at 10 on the Mohs scale.'],
  ['Which planet is known as the Red Planet?', ['Venus', 'Jupiter', 'Mars', 'Saturn'], 2, 'easy', 'Iron oxide dust on the surface gives Mars its colour.'],
  ['What does DNA stand for?', ['Deoxyribonucleic acid', 'Dinucleic acid', 'Deoxyribose nutrient acid', 'Dual nucleic acid'], 0, 'medium', 'It carries the genetic instructions of an organism.'],
  ['Sound travels fastest through which medium?', ['Vacuum', 'Air', 'Water', 'Steel'], 3, 'medium', 'The denser and stiffer the medium, the faster sound moves.'],
  ['What is the unit of electrical resistance?', ['Volt', 'Ampere', 'Ohm', 'Watt'], 2, 'medium', 'Resistance is measured in ohms, after Georg Ohm.'],
  ['Which is the largest planet in the Solar System?', ['Saturn', 'Neptune', 'Jupiter', 'Uranus'], 2, 'easy', 'Jupiter is more massive than all the other planets combined.'],
  ['What process turns a liquid into a gas?', ['Condensation', 'Evaporation', 'Sublimation', 'Freezing'], 1, 'easy', 'Evaporation happens at the surface of a liquid as it gains energy.'],
  ['Which planet is shown here?', ['Mars', 'Saturn', 'Venus', 'Mercury'], 1, 'easy', 'Saturn’s ring system is the widest and brightest in the Solar System.', 'saturn'],
  ['What does this diagram represent?', ['An atom', 'A galaxy', 'A cell', 'A molecule of water'], 0, 'easy', 'A dense nucleus with electrons in orbit around it.', 'atom'],
];

const SPORTS = [
  ['How many players are on the field per cricket team?', ['9', '10', '11', '12'], 2, 'easy', 'Eleven a side, plus any permitted substitutes off the field.'],
  ['How many runs is a boundary hit along the ground worth?', ['2', '4', '6', '8'], 1, 'easy', 'Along the ground is four; over the rope on the full is six.'],
  ['In football, how long is a standard match?', ['60 minutes', '80 minutes', '90 minutes', '100 minutes'], 2, 'easy', 'Two halves of 45 minutes, plus stoppage time.'],
  ['Which country won the 2011 Cricket World Cup?', ['Australia', 'Sri Lanka', 'India', 'England'], 2, 'easy', 'India beat Sri Lanka in the final in Mumbai.'],
  ['How many players are on a basketball team on court?', ['4', '5', '6', '7'], 1, 'easy', 'Five per side at any one time.'],
  ['What is a score of one under par called in golf?', ['Eagle', 'Birdie', 'Bogey', 'Albatross'], 1, 'medium', 'One under is a birdie; two under is an eagle.'],
  ['How often are the Summer Olympic Games held?', ['Every 2 years', 'Every 3 years', 'Every 4 years', 'Every 5 years'], 2, 'easy', 'Every four years, barring cancellation.'],
  ['In tennis, what is a score of zero called?', ['Nil', 'Love', 'Duck', 'Blank'], 1, 'easy', 'Zero is called love in tennis scoring.'],
  ['Which sport uses a shuttlecock?', ['Squash', 'Table tennis', 'Badminton', 'Tennis'], 2, 'easy', 'Badminton is played with a shuttlecock rather than a ball.'],
  ['How many rings are on the Olympic flag?', ['4', '5', '6', '7'], 1, 'easy', 'Five interlocking rings, one per inhabited continent.'],
  ['In cricket, what dismissal is it when the bails are removed with the batter out of the crease?', ['Caught', 'Bowled', 'Stumped', 'Run out'], 2, 'medium', 'Stumped is by the wicketkeeper; run out is by any fielder.'],
  ['Which country hosts the Wimbledon tennis tournament?', ['France', 'United States', 'Australia', 'England'], 3, 'easy', 'Wimbledon is played in London.'],
  ['How many points is a touchdown worth in American football?', ['3', '5', '6', '7'], 2, 'medium', 'Six, with a conversion attempt afterwards.'],
  ['What is the maximum break in snooker?', ['135', '147', '155', '167'], 1, 'medium', 'Fifteen reds with fifteen blacks, then the colours: 147.'],
  ['In which sport would you perform a slam dunk?', ['Volleyball', 'Basketball', 'Handball', 'Netball'], 1, 'easy', 'A dunk is scored by putting the ball directly through the hoop.'],
  ['How many holes are played in a full round of golf?', ['9', '12', '18', '24'], 2, 'easy', 'A standard round is eighteen holes.'],
  ['Which Indian city hosts the Eden Gardens cricket ground?', ['Mumbai', 'Chennai', 'Kolkata', 'Delhi'], 2, 'medium', 'Eden Gardens is in Kolkata.'],
  ['In football, how many players can a team have sent off before the match is abandoned?', ['3', '4', '5', '6'], 2, 'medium', 'A team reduced below seven players cannot continue.'],
  ['What colour jersey does the Tour de France leader wear?', ['Green', 'Yellow', 'Red', 'White'], 1, 'medium', 'The maillot jaune marks the overall leader.'],
  ['How many periods are in an ice hockey match?', ['2', '3', '4', '5'], 1, 'medium', 'Three periods of twenty minutes each.'],
  ['Which sport is played at the Ranji Trophy?', ['Hockey', 'Football', 'Cricket', 'Kabaddi'], 2, 'easy', 'The Ranji Trophy is India’s domestic first-class cricket competition.'],
  ['How many players are in a kabaddi team on the mat?', ['5', '6', '7', '8'], 2, 'easy', 'Seven a side, with substitutes available.'],
];

const HISTORY = [
  ['In which year did India gain independence?', ['1945', '1947', '1950', '1952'], 1, 'easy', 'India became independent on 15 August 1947.'],
  ['Who was the first Prime Minister of India?', ['Sardar Patel', 'Jawaharlal Nehru', 'Rajendra Prasad', 'Lal Bahadur Shastri'], 1, 'easy', 'Nehru took office in 1947.'],
  ['The Taj Mahal was built by which emperor?', ['Akbar', 'Babur', 'Shah Jahan', 'Aurangzeb'], 2, 'easy', 'Shah Jahan built it as a mausoleum for Mumtaz Mahal.'],
  ['In which year did the Second World War end?', ['1943', '1944', '1945', '1946'], 2, 'easy', 'It ended in 1945.'],
  ['Who wrote the Indian national anthem?', ['Bankim Chandra', 'Rabindranath Tagore', 'Sarojini Naidu', 'Subramania Bharati'], 1, 'easy', 'Tagore wrote Jana Gana Mana.'],
  ['Which civilisation built Mohenjo-daro?', ['Mauryan', 'Gupta', 'Indus Valley', 'Chola'], 2, 'medium', 'Mohenjo-daro is one of the great Indus Valley cities.'],
  ['Who was the first President of India?', ['Rajendra Prasad', 'S. Radhakrishnan', 'Zakir Husain', 'V. V. Giri'], 0, 'medium', 'Rajendra Prasad served from 1950 to 1962.'],
  ['The Great Wall was built primarily in which country?', ['Japan', 'India', 'China', 'Mongolia'], 2, 'easy', 'It was built across the northern borders of China.'],
  ['Which empire was ruled by Ashoka?', ['Gupta', 'Mauryan', 'Mughal', 'Maratha'], 1, 'medium', 'Ashoka ruled the Mauryan Empire in the 3rd century BCE.'],
  ['In which year did the First World War begin?', ['1912', '1914', '1916', '1918'], 1, 'easy', 'It began in 1914 and ended in 1918.'],
  ['Who led the Salt March of 1930?', ['Nehru', 'Gandhi', 'Bose', 'Tilak'], 1, 'easy', 'Gandhi marched to Dandi to make salt in defiance of the salt tax.'],
  ['Which ancient city was buried by Mount Vesuvius?', ['Athens', 'Carthage', 'Pompeii', 'Troy'], 2, 'medium', 'Pompeii was buried by the eruption of 79 CE.'],
  ['Who was the first Mughal emperor?', ['Akbar', 'Babur', 'Humayun', 'Jahangir'], 1, 'medium', 'Babur founded the Mughal Empire in 1526.'],
  ['The Battle of Plassey was fought in which year?', ['1757', '1764', '1857', '1875'], 0, 'medium', 'The 1757 battle established British power in Bengal.'],
  ['Who was known as the Iron Man of India?', ['Nehru', 'Bhagat Singh', 'Sardar Patel', 'Tilak'], 2, 'easy', 'Sardar Vallabhbhai Patel integrated the princely states.'],
  ['Which Indian revolt is called the First War of Independence?', ['1857 Revolt', 'Quit India', 'Champaran', 'Non-Cooperation'], 0, 'medium', 'The 1857 uprising against the East India Company.'],
  ['Who discovered the sea route to India from Europe?', ['Columbus', 'Magellan', 'Vasco da Gama', 'Marco Polo'], 2, 'medium', 'Vasco da Gama reached Calicut in 1498.'],
  ['The Indian Constitution came into effect in which year?', ['1947', '1949', '1950', '1952'], 2, 'easy', 'It came into force on 26 January 1950.'],
  ['Who chaired the drafting committee of the Indian Constitution?', ['Nehru', 'B. R. Ambedkar', 'Rajendra Prasad', 'Sardar Patel'], 1, 'medium', 'Dr B. R. Ambedkar chaired the drafting committee.'],
  ['Which dynasty built the Konark Sun Temple?', ['Chola', 'Pallava', 'Eastern Ganga', 'Chalukya'], 2, 'hard', 'It was built in the 13th century by the Eastern Ganga dynasty.'],
  ['Who was the last Viceroy of India?', ['Lord Curzon', 'Lord Mountbatten', 'Lord Irwin', 'Lord Wavell'], 1, 'medium', 'Lord Mountbatten oversaw the transfer of power in 1947.'],
  ['In which year did the Berlin Wall fall?', ['1987', '1989', '1991', '1993'], 1, 'medium', 'The wall was opened on 9 November 1989.'],
];

const GENERAL = [
  ['What is the capital of India?', ['Mumbai', 'New Delhi', 'Kolkata', 'Chennai'], 1, 'easy', 'New Delhi has been the capital since 1911.'],
  ['Which is the longest river in the world?', ['Amazon', 'Nile', 'Yangtze', 'Ganga'], 1, 'easy', 'The Nile runs roughly 6,650 km.'],
  ['How many continents are there?', ['5', '6', '7', '8'], 2, 'easy', 'Seven, by the most common convention.'],
  ['What is the currency of Japan?', ['Yuan', 'Won', 'Yen', 'Ringgit'], 2, 'easy', 'Japan uses the yen.'],
  ['Which is the largest ocean?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3, 'easy', 'The Pacific is the largest and deepest.'],
  ['How many colours are in a rainbow?', ['5', '6', '7', '8'], 2, 'easy', 'Seven, by the traditional listing.'],
  ['What is the capital of France?', ['Lyon', 'Marseille', 'Paris', 'Nice'], 2, 'easy', 'Paris is the capital and largest city.'],
  ['Which country is known as the Land of the Rising Sun?', ['China', 'Japan', 'Thailand', 'Korea'], 1, 'easy', 'The name Nippon means origin of the sun.'],
  ['How many days are in a leap year?', ['364', '365', '366', '367'], 2, 'easy', 'A leap year adds 29 February.'],
  ['Which is the smallest country in the world?', ['Monaco', 'Nauru', 'Vatican City', 'San Marino'], 2, 'medium', 'Vatican City covers about 0.44 square kilometres.'],
  ['What is the national animal of India?', ['Lion', 'Elephant', 'Tiger', 'Peacock'], 2, 'easy', 'The Bengal tiger. The peacock is the national bird.'],
  ['Which planet do we live on?', ['Mars', 'Venus', 'Earth', 'Mercury'], 2, 'easy', 'Earth is the third planet from the Sun.'],
  ['How many states are there in India?', ['26', '28', '29', '30'], 1, 'medium', 'Twenty-eight states and eight union territories.'],
  ['Which is the tallest mountain above sea level?', ['K2', 'Kangchenjunga', 'Everest', 'Makalu'], 2, 'easy', 'Everest rises to 8,849 metres.'],
  ['What is the capital of Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Perth'], 2, 'medium', 'Canberra was chosen as a compromise capital.'],
  ['How many minutes are in a full day?', ['1,200', '1,440', '1,660', '2,400'], 1, 'medium', '24 hours multiplied by 60 minutes.'],
  ['Which language has the most native speakers?', ['English', 'Hindi', 'Spanish', 'Mandarin Chinese'], 3, 'medium', 'Mandarin has the most native speakers.'],
  ['What is the largest mammal on Earth?', ['Elephant', 'Blue whale', 'Giraffe', 'Hippopotamus'], 1, 'easy', 'The blue whale is the largest animal known to have existed.'],
  ['Which river flows through Varanasi?', ['Yamuna', 'Ganga', 'Narmada', 'Godavari'], 1, 'easy', 'Varanasi sits on the banks of the Ganga.'],
  ['How many sides does a hexagon have?', ['5', '6', '7', '8'], 1, 'easy', 'Hexa means six.'],
  ['What is the capital of the United Kingdom?', ['Manchester', 'Birmingham', 'London', 'Edinburgh'], 2, 'easy', 'London is the capital.'],
  ['Which gas makes up most of the Sun?', ['Oxygen', 'Helium', 'Hydrogen', 'Carbon'], 2, 'medium', 'The Sun is roughly three-quarters hydrogen by mass.'],
  ['Which country’s flag is this?', ['China', 'Japan', 'South Korea', 'Bangladesh'], 1, 'easy', 'A crimson disc centred on a white field.', 'flag-jp'],
  ['Which country’s flag is this?', ['India', 'Ireland', 'Niger', 'Ivory Coast'], 0, 'easy', 'Saffron, white and green, with the navy Ashoka Chakra at the centre.', 'flag-in'],
  ['Which country’s flag is this?', ['Netherlands', 'Russia', 'France', 'Italy'], 2, 'easy', 'Three vertical bands: blue, white and red.', 'flag-fr'],
  ['Which country’s flag is this?', ['Belgium', 'Germany', 'Austria', 'Spain'], 1, 'easy', 'Three horizontal bands: black, red and gold.', 'flag-de'],
  ['Which country’s flag is this?', ['Denmark', 'Switzerland', 'Norway', 'Georgia'], 1, 'medium', 'A white cross on red — and one of only two square national flags.', 'flag-ch'],
  ['Which country’s flag is this?', ['Finland', 'Iceland', 'Sweden', 'Norway'], 2, 'medium', 'A yellow Nordic cross, offset towards the hoist, on blue.', 'flag-se'],
];

/**
 * ── The picture topics ─────────────────────────────────────────────────────
 *
 * Four banks whose subject is an emblem, so roughly a third of each is a
 * picture question. They are here because a text-only catalogue never exercises
 * the image path, and because "which emblem is this?" is the question the
 * feature exists for — the round screen sizes and positions art quite
 * differently from a paragraph, and nothing else in the seed made it do that.
 */

const WIZARDING = [
  ['Which emblem is this?', ['The Deathly Hallows', 'The Elder Wand alone', 'A Hogwarts house crest', 'The Ministry seal'], 0, 'medium', 'The triangle, circle and line together stand for the Cloak, the Stone and the Wand.', 'hallows'],
  ['Which object is shown here?', ['A Golden Snitch', 'A Remembrall', 'A Time-Turner', 'A Quaffle'], 0, 'easy', 'The winged golden ball worth 150 points, and the one that ends the game.', 'snitch'],
  ['What is this pointed hat used for?', ['Sorting students into houses', 'Brewing potions', 'Silencing a room', 'Travelling by Floo'], 0, 'easy', 'The Sorting Hat reads a new student and calls out their house.', 'hat'],
  ['This mark is famous on whose forehead?', ['Harry Potter', 'Ron Weasley', 'Neville Longbottom', 'Draco Malfoy'], 0, 'easy', 'The lightning-bolt scar Harry has carried since he was a year old.', 'bolt'],
  ['How many Hogwarts houses are there?', ['Four', 'Three', 'Five', 'Seven'], 0, 'easy', 'Gryffindor, Hufflepuff, Ravenclaw and Slytherin.'],
  ['Which house does Harry Potter belong to?', ['Gryffindor', 'Slytherin', 'Ravenclaw', 'Hufflepuff'], 0, 'easy', 'The Sorting Hat considered Slytherin, but Harry asked for otherwise.'],
  ['What is the name of Harry’s owl?', ['Hedwig', 'Errol', 'Pigwidgeon', 'Crookshanks'], 0, 'easy', 'A snowy owl, and a birthday present from Hagrid.'],
  ['Which platform does the Hogwarts Express leave from?', ['Nine and Three-Quarters', 'Nine', 'Ten', 'Eleven'], 0, 'easy', 'Reached by walking straight at the barrier between platforms nine and ten.'],
  ['Who is the Headmaster of Hogwarts for most of the series?', ['Albus Dumbledore', 'Severus Snape', 'Minerva McGonagall', 'Horace Slughorn'], 0, 'easy', 'Dumbledore leads Hogwarts until the end of the sixth book.'],
  ['What is the name of Hagrid’s three-headed dog?', ['Fluffy', 'Fang', 'Norbert', 'Buckbeak'], 0, 'medium', 'Fluffy guards the trapdoor to the Philosopher’s Stone.'],
  ['Which spell disarms an opponent?', ['Expelliarmus', 'Lumos', 'Alohomora', 'Wingardium Leviosa'], 0, 'easy', 'Harry’s signature spell throws the target’s wand out of their hand.'],
  ['Which spell produces light from a wand tip?', ['Lumos', 'Nox', 'Accio', 'Reparo'], 0, 'easy', 'Nox is the counter-spell that puts it out.'],
  ['Which spell summons an object to you?', ['Accio', 'Expecto Patronum', 'Obliviate', 'Riddikulus'], 0, 'medium', 'The Summoning Charm, which Harry drills before the first task.'],
  ['What form does Harry’s Patronus take?', ['A stag', 'A doe', 'An otter', 'A phoenix'], 0, 'medium', 'The same form as his father’s Animagus shape.'],
  ['What is the name of the Weasley family home?', ['The Burrow', 'Shell Cottage', 'Grimmauld Place', 'Godric’s Hollow'], 0, 'medium', 'A crooked house held up largely by magic.'],
  ['Which position does Harry play in Quidditch?', ['Seeker', 'Keeper', 'Chaser', 'Beater'], 0, 'easy', 'The Seeker chases the Snitch, and Harry is the youngest in a century.'],
  ['What is Voldemort’s birth name?', ['Tom Riddle', 'Tom Gaunt', 'Marvolo Slytherin', 'Salazar Riddle'], 0, 'medium', 'Tom Marvolo Riddle, rearranged into "I am Lord Voldemort".'],
  ['Which creature guards Azkaban?', ['Dementors', 'Trolls', 'Goblins', 'Centaurs'], 0, 'medium', 'Dementors feed on happiness, which is why the Patronus works against them.'],
  ['What is a Horcrux?', ['An object holding part of a soul', 'A wizarding bank vault', 'A protective charm', 'A magical map'], 0, 'hard', 'Splitting the soul requires murder, which is what makes it so dark.'],
  ['Which shop sells wands in Diagon Alley?', ['Ollivanders', 'Flourish and Blotts', 'Gringotts', 'Zonko’s'], 0, 'medium', '"The wand chooses the wizard."'],
  ['Who kills Bellatrix Lestrange?', ['Molly Weasley', 'Ginny Weasley', 'Hermione Granger', 'Luna Lovegood'], 0, 'hard', 'During the Battle of Hogwarts, defending her daughter.'],
  ['What does the Marauder’s Map show?', ['Everyone’s location in Hogwarts', 'Every secret passage only', 'The future', 'Hidden treasure'], 0, 'hard', 'It names and tracks every person in the castle, in real time.'],
];

const MARVEL = [
  ['Whose chest device is this?', ['Iron Man', 'Captain Marvel', 'Vision', 'Star-Lord'], 0, 'medium', 'The arc reactor keeps shrapnel from Tony Stark’s heart and powers the suit.', 'reactor'],
  ['Which hero uses this emblem?', ['Spider-Man', 'Black Widow', 'Ant-Man', 'Daredevil'], 0, 'easy', 'The spider Peter Parker wears across his chest.', 'arachnid'],
  ['What is this weapon called?', ['Mjölnir', 'Stormbreaker', 'The Bifrost', 'Gungnir'], 0, 'easy', 'Thor’s hammer, which only the worthy can lift.', 'hammer'],
  ['What do the six stones on this gauntlet do?', ['Control fundamental aspects of the universe', 'Grant six separate wishes', 'Summon six armies', 'Open six portals'], 0, 'medium', 'Space, Mind, Reality, Power, Time and Soul.', 'gauntlet'],
  ['What is Spider-Man’s real name?', ['Peter Parker', 'Miles Morales', 'Harry Osborn', 'Eddie Brock'], 0, 'easy', 'Miles Morales is the other Spider-Man, from a different story.'],
  ['Which metal is Wolverine’s skeleton bonded with?', ['Adamantium', 'Vibranium', 'Uru', 'Titanium'], 0, 'medium', 'Vibranium is Wakanda’s metal; adamantium is Wolverine’s.'],
  ['Who is the Black Panther?', ['T’Challa', 'M’Baku', 'Killmonger', 'Shuri'], 0, 'easy', 'The king of Wakanda takes the mantle.'],
  ['What is Doctor Strange’s profession before becoming a sorcerer?', ['Neurosurgeon', 'Lawyer', 'Physicist', 'Soldier'], 0, 'medium', 'A car accident ruins his hands and sends him looking for a cure.'],
  ['Which country is Black Panther from?', ['Wakanda', 'Latveria', 'Sokovia', 'Genosha'], 0, 'easy', 'Hidden behind a projected image of farmland.'],
  ['What is the Hulk’s alter ego called?', ['Bruce Banner', 'Reed Richards', 'Hank Pym', 'Stephen Strange'], 0, 'easy', 'A gamma radiation accident does the rest.'],
  ['Who leads the Guardians of the Galaxy?', ['Star-Lord', 'Rocket', 'Gamora', 'Drax'], 0, 'medium', 'Peter Quill, who insists on the name.'],
  ['Which Infinity Stone is hidden in the Tesseract?', ['Space', 'Mind', 'Time', 'Reality'], 0, 'hard', 'The Mind Stone sat in Loki’s sceptre instead.'],
  ['What is Ant-Man’s real name in the films?', ['Scott Lang', 'Hank Pym', 'Bruce Banner', 'Clint Barton'], 0, 'medium', 'Hank Pym was the original Ant-Man and hands the suit over.'],
  ['Which shield metal absorbs vibration?', ['Vibranium', 'Adamantium', 'Uru', 'Carbonadium'], 0, 'easy', 'Which is why Captain America’s shield takes any hit.'],
  ['Who is Thor’s adopted brother?', ['Loki', 'Heimdall', 'Balder', 'Fandral'], 0, 'easy', 'A frost giant raised in Asgard.'],
  ['What does S.H.I.E.L.D. protect against?', ['Global and extraterrestrial threats', 'Financial crime only', 'Weather disasters', 'Cyber attacks only'], 0, 'medium', 'Nick Fury runs it for most of the story.'],
  ['Which Avenger is a master archer?', ['Hawkeye', 'Falcon', 'War Machine', 'Winter Soldier'], 0, 'easy', 'Clint Barton, who never misses.'],
  ['What is Tony Stark’s AI assistant originally called?', ['J.A.R.V.I.S.', 'F.R.I.D.A.Y.', 'K.A.R.E.N.', 'E.D.I.T.H.'], 0, 'medium', 'F.R.I.D.A.Y. replaces J.A.R.V.I.S. later on.'],
  ['Which villain seeks to balance the universe by halving it?', ['Thanos', 'Ultron', 'Loki', 'Red Skull'], 0, 'easy', 'He believes it is mercy.'],
  ['Who created Ultron?', ['Tony Stark and Bruce Banner', 'Hank Pym alone', 'Thanos', 'Nick Fury'], 0, 'hard', 'Using the Mind Stone, and without telling the others.'],
  ['What is Captain America’s real name?', ['Steve Rogers', 'Bucky Barnes', 'Sam Wilson', 'John Walker'], 0, 'easy', 'A volunteer for the super-soldier programme.'],
  ['Which team does Professor X lead?', ['The X-Men', 'The Avengers', 'The Fantastic Four', 'The Defenders'], 0, 'medium', 'A school for mutants that is also a team.'],
];

const AVENGERS = [
  ['Which shield is this?', ['Captain America’s', 'Black Panther’s', 'Shuri’s gauntlet', 'The Wakandan royal seal'], 0, 'easy', 'Concentric rings around a star, struck in vibranium.', 'shield'],
  ['Whose chest light is this?', ['Iron Man', 'Ultron', 'Vision', 'Rescue'], 0, 'medium', 'The arc reactor is Iron Man’s, and the first thing he builds in a cave.', 'reactor'],
  ['This hammer belongs to which Avenger?', ['Thor', 'Hercules', 'Beta Ray Bill', 'Odin'], 0, 'easy', 'Mjölnir answers only to the worthy.', 'hammer'],
  ['Which Avengers film features this gauntlet?', ['Infinity War', 'The first Avengers', 'Age of Ultron', 'Civil War'], 0, 'medium', 'Thanos assembles all six stones on it.', 'gauntlet'],
  ['Who are the six original Avengers on film?', ['Iron Man, Cap, Thor, Hulk, Black Widow, Hawkeye', 'Iron Man, Cap, Thor, Hulk, Falcon, Vision', 'Cap, Thor, Hulk, Ant-Man, Wasp, Vision', 'Iron Man, Cap, Thor, Hulk, Spider-Man, Strange'], 0, 'medium', 'Assembled to stop the Chitauri over New York.'],
  ['Which city is attacked in the first Avengers film?', ['New York', 'London', 'Sokovia', 'Wakanda'], 0, 'easy', 'The Battle of New York, through a portal above Stark Tower.'],
  ['What is the name of the Avengers’ flying headquarters?', ['The Helicarrier', 'The Quinjet', 'The Milano', 'The Benatar'], 0, 'medium', 'S.H.I.E.L.D.’s aircraft carrier that flies.'],
  ['Which country is Sokovia’s disaster tied to?', ['Ultron’s plan', 'Loki’s invasion', 'Thanos’s snap', 'Hydra’s founding'], 0, 'medium', 'Ultron lifts the city to drop it as an extinction event.'],
  ['Who says "I am Iron Man" at the end of the first film?', ['Tony Stark', 'James Rhodes', 'Pepper Potts', 'Nick Fury'], 0, 'easy', 'Going off-script at the press conference.'],
  ['What splits the Avengers in Civil War?', ['The Sokovia Accords', 'The Infinity Stones', 'Ultron', 'The Tesseract'], 0, 'medium', 'Oversight versus autonomy, with Bucky in the middle.'],
  ['Which Avenger sacrifices themselves for the Soul Stone?', ['Black Widow', 'Hawkeye', 'Iron Man', 'Gamora'], 0, 'hard', 'Gamora is also sacrificed for it, but by Thanos, earlier.'],
  ['Who wields the Infinity Gauntlet to undo the snap?', ['Hulk', 'Iron Man', 'Thor', 'Captain Marvel'], 0, 'hard', 'Bruce Banner, because gamma radiation lets him survive it.'],
  ['What is the Quinjet?', ['The Avengers’ transport aircraft', 'A Wakandan weapon', 'A S.H.I.E.L.D. rank', 'Thor’s ship'], 0, 'easy', 'Short take-off, long range, and always parked on the roof.'],
  ['Who becomes Captain America at the end of Endgame?', ['Sam Wilson', 'Bucky Barnes', 'John Walker', 'Steve Rogers stays'], 0, 'medium', 'Steve hands Sam the shield himself.'],
  ['Which Avenger is known as the God of Thunder?', ['Thor', 'Loki', 'Odin', 'Heimdall'], 0, 'easy', 'Asgardian, and heir to the throne.'],
  ['What weapon does Thor forge in Infinity War?', ['Stormbreaker', 'A new Mjölnir', 'Gungnir', 'The Bifrost sword'], 0, 'medium', 'Forged at Nidavellir, with Groot’s arm as the handle.'],
  ['Who is Vision created from?', ['J.A.R.V.I.S. and the Mind Stone', 'Ultron alone', 'Thor’s lightning only', 'Bruce Banner’s mind'], 0, 'hard', 'Stark’s AI, synthetic vibranium and the Mind Stone, sparked by Thor.'],
  ['Which Avenger shrinks?', ['Ant-Man', 'Hawkeye', 'Falcon', 'War Machine'], 0, 'easy', 'The Pym Particle does the work.'],
  ['What is the time-travel method in Endgame called?', ['The Quantum Realm', 'The Bifrost', 'The Time Stone alone', 'A Horcrux'], 0, 'medium', 'Reached by shrinking past the subatomic.'],
  ['Who is Nick Fury’s trusted deputy?', ['Maria Hill', 'Sharon Carter', 'Peggy Carter', 'Melinda May'], 0, 'medium', 'She stays with him through the fall of S.H.I.E.L.D.'],
  ['Which Avenger has no superpowers at all?', ['Hawkeye', 'Captain America', 'Vision', 'Captain Marvel'], 0, 'medium', 'Clint Barton is simply extremely good at one thing.'],
  ['What phrase does Captain America use to rally the team?', ['Avengers assemble', 'Avengers advance', 'Avengers rise', 'To me, Avengers'], 0, 'easy', 'Held back until the last battle.'],
];

const HINDU_MYTH = [
  ['Which weapon is this?', ['The trishul of Shiva', 'The gada of Hanuman', 'The chakra of Vishnu', 'The vajra of Indra'], 0, 'easy', 'A three-pronged spear standing for creation, preservation and destruction.', 'trishul'],
  ['This wheel is the emblem of which idea?', ['Dharma, the wheel of law', 'The sun’s chariot', 'The cycle of seasons', 'A potter’s wheel'], 0, 'medium', 'The Ashoka Chakra carries the same wheel onto India’s flag.', 'chakra'],
  ['Which flower is shown, and which goddess is seated on it?', ['Lotus — Lakshmi', 'Marigold — Durga', 'Jasmine — Saraswati', 'Hibiscus — Kali'], 0, 'medium', 'Lakshmi is depicted seated on a blooming lotus.', 'lotus'],
  ['This shell is blown at the start of what?', ['A battle or a ritual', 'A harvest only', 'A wedding only', 'A coronation only'], 0, 'medium', 'The shankha announces both war and worship.', 'conch'],
  ['Which festival is this lamp most associated with?', ['Diwali', 'Holi', 'Onam', 'Pongal'], 0, 'easy', 'Rows of diyas give Deepavali its name.', 'diya'],
  ['Who are the three deities of the Trimurti?', ['Brahma, Vishnu, Shiva', 'Indra, Agni, Vayu', 'Rama, Krishna, Shiva', 'Ganesha, Kartikeya, Shiva'], 0, 'easy', 'Creator, preserver and destroyer.'],
  ['Who is the elephant-headed god?', ['Ganesha', 'Hanuman', 'Kartikeya', 'Kubera'], 0, 'easy', 'Invoked at the start of any new undertaking.'],
  ['Which epic tells the story of Rama?', ['The Ramayana', 'The Mahabharata', 'The Bhagavata Purana', 'The Rigveda'], 0, 'easy', 'Attributed to the sage Valmiki.'],
  ['Who narrates the Bhagavad Gita to Arjuna?', ['Krishna', 'Vyasa', 'Bhishma', 'Yudhishthira'], 0, 'easy', 'On the battlefield of Kurukshetra, before the fighting begins.'],
  ['How many Pandava brothers are there?', ['Five', 'Three', 'Seven', 'Four'], 0, 'easy', 'Yudhishthira, Bhima, Arjuna, Nakula and Sahadeva.'],
  ['Who is the monkey god who serves Rama?', ['Hanuman', 'Sugriva', 'Vali', 'Jambavan'], 0, 'easy', 'Famous for leaping to Lanka.'],
  ['Which river is considered most sacred?', ['The Ganga', 'The Yamuna', 'The Godavari', 'The Kaveri'], 0, 'easy', 'Said to descend from heaven through Shiva’s hair.'],
  ['Who is the goddess of learning and music?', ['Saraswati', 'Lakshmi', 'Parvati', 'Durga'], 0, 'easy', 'Depicted with a veena and a swan.'],
  ['Who is Shiva’s consort?', ['Parvati', 'Lakshmi', 'Saraswati', 'Ganga'], 0, 'medium', 'Also known as Uma, and in fiercer form as Durga and Kali.'],
  ['What is Vishnu’s discus weapon called?', ['Sudarshana Chakra', 'Trishul', 'Vajra', 'Gada'], 0, 'medium', 'A spinning disc that always returns.'],
  ['Who is the king of the gods in Vedic tradition?', ['Indra', 'Agni', 'Varuna', 'Surya'], 0, 'medium', 'God of thunder and rain, wielding the vajra.'],
  ['How many avatars does Vishnu traditionally have?', ['Ten', 'Seven', 'Twelve', 'Eight'], 0, 'medium', 'The Dashavatara, from Matsya to Kalki.'],
  ['Which demon king does Rama defeat?', ['Ravana', 'Kumbhakarna', 'Hiranyakashipu', 'Mahishasura'], 0, 'easy', 'The ten-headed king of Lanka.'],
  ['Which goddess slays the buffalo demon Mahishasura?', ['Durga', 'Kali', 'Saraswati', 'Lakshmi'], 0, 'medium', 'Celebrated at Navratri and Durga Puja.'],
  ['What is Krishna’s birthplace?', ['Mathura', 'Ayodhya', 'Dwarka', 'Vrindavan'], 0, 'medium', 'He is raised in Gokul and later rules from Dwarka.'],
  ['Who wrote down the Mahabharata as Vyasa dictated it?', ['Ganesha', 'Hanuman', 'Narada', 'Valmiki'], 0, 'hard', 'On the condition that Vyasa never pause.'],
  ['What is the churning of the ocean called?', ['Samudra Manthan', 'Kurukshetra', 'Ramayana', 'Ashvamedha'], 0, 'hard', 'Gods and asuras churn the ocean for the nectar of immortality.'],
];

/**
 * Fourteen topics across the ten categories. `icon` overrides the category
 * glyph where a topic deserves its own; otherwise it inherits.
 */
const TOPICS = [
  { name: 'Python', category: 'Programming', bank: PYTHON, description: 'The language, from print() to comprehensions.' },
  { name: 'MySQL', category: 'Programming', bank: MYSQL, description: 'SELECTs, JOINs, keys and indexes.' },
  { name: 'Basic Maths', category: 'Mathematics', bank: BASIC_MATHS, description: 'Arithmetic, percentages and quick mental maths.' },
  { name: 'Roman Numbers', category: 'Mathematics', bank: ROMAN_NUMBERS, description: 'From IV to MMXXVI — read them at speed.' },
  { name: 'Indian Actors', category: 'Entertainment', bank: INDIAN_ACTORS, description: 'Debuts, famous roles and screen legends.' },
  { name: 'Indian Movies', category: 'Entertainment', bank: INDIAN_MOVIES, description: 'From Sholay to Baahubali — the settled classics.' },
  { name: 'Science Basics', category: 'Science', bank: SCIENCE, description: 'Bodies, planets and the rules everything obeys.' },
  { name: 'Sports Trivia', category: 'Sports', bank: SPORTS, description: 'Cricket, football and the rules of the rest.' },
  { name: 'Indian History', category: 'History', bank: HISTORY, description: 'Empires, independence and the dates that stuck.' },
  { name: 'World GK', category: 'General Knowledge', bank: GENERAL, description: 'Capitals, rivers and the things everyone half-knows.' },
  { name: 'Wizarding World', category: 'Harry Potter', bank: WIZARDING, description: 'Houses, spells and the emblems behind them.' },
  { name: 'Marvel Universe', category: 'Marvel', bank: MARVEL, description: 'Heroes, metals and the marks they wear.' },
  { name: 'The Avengers', category: 'Marvel', bank: AVENGERS, description: 'Assembled, split, and assembled again.' },
  { name: 'Hindu Mythology', category: 'Mythology', bank: HINDU_MYTH, description: 'Epics, deities and the symbols they carry.' },
];

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

/**
 * Drop every collection in the connected database.
 *
 * Driven off what the DATABASE actually contains, not off the model registry.
 * The registry version could only ever delete collections the code still knows
 * about, so anything the code had forgotten survived it untouched: a model
 * deleted from `models/index.js`, a collection renamed in a later schema, one
 * written by a migration or by hand. Those are precisely the records a wipe
 * exists to remove, and they are the ones that outlive it — and because the
 * seed reported "wiped 22 collections" either way, it looked like it had done
 * its job while the orphans were still sitting there.
 *
 * Dropped rather than emptied, so the indexes go too. An index whose shape
 * changed with the schema is not removed by `deleteMany`, and a stale unique
 * index over a field that no longer means what it used to shows up much later
 * as writes mysteriously failing. `ensureIndexes()` rebuilds them from the
 * schemas immediately afterwards.
 */
async function wipe() {
  const db = mongoose.connection.db;
  const present = (await db.listCollections().toArray())
    .filter((c) => c.type === 'collection' && !c.name.startsWith('system.'))
    .map((c) => c.name)
    .sort();

  for (const name of present) await db.dropCollection(name);

  // Reported against the registry so a mismatch is visible rather than
  // silent — if the database held collections this code cannot name, that is
  // worth seeing in the output.
  const known = new Set(
    Object.values(models)
      .filter((m) => m && typeof m === 'function' && m.modelName)
      .map((m) => m.collection.name),
  );
  const unknown = present.filter((n) => !known.has(n));

  console.log(`  dropped ${present.length} collections${present.length ? `: ${present.join(', ')}` : ''}`);
  if (unknown.length) console.log(`  (${unknown.length} not backed by any current model: ${unknown.join(', ')})`);
}

/**
 * The demo account, unlocked to the top.
 *
 * `totalXp` is read from the curve rather than typed in, so editing the curve
 * cannot leave this account stranded below the last level it is meant to show.
 */
async function makeDemoPlayer(curve, catalogue) {
  const { rankedRating, coins, ...player } = DEMO_PLAYER;
  return User.create({
    phone: player.phone,
    displayName: player.displayName,
    displayNameLower: player.displayName.toLowerCase(),
    avatarUrl: `mimo:avatar/${player.avatar}`,
    banner: `mimo:banner/${player.banner}`,
    title: player.title,
    country: 'IN',
    role: 'player',
    status: 'active',
    rankedRating,
    rankedMatches: 40,
    matchesPlayed: 40,
    matchesWon: 24,
    totalXp: curve[curve.length - 1],
    coins,
    streak: { ...player.streak, lastPlayedOn: istDateKey() },
    /** Every wearable, so all four tiers are visible side by side. */
    grantedPerks: catalogue.filter((c) => c.type !== 'title').map((c) => c.key),
    /**
     * Every achievement, earned.
     *
     * Not vanity: the achievements screen draws earned and unearned rows
     * differently, and with a fresh database there was no account anywhere that
     * could show the earned half of it. The other account has none, so the two
     * together cover both states.
     */
    achievements: ACHIEVEMENTS.map((a, i) => ({
      key: a.key,
      earnedAt: new Date(Date.now() - (ACHIEVEMENTS.length - i) * 24 * 60 * 60 * 1000),
    })),
  });
}

async function makeSuperadmin({ phone, displayName, avatar }) {
  return User.create({
    phone,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    avatarUrl: `mimo:avatar/${avatar}`,
    banner: 'mimo:banner/night-dots',
    country: 'IN',
    role: 'superadmin',
    status: 'active',
    rankedRating: RANKED_START,
    totalXp: 0,
    /**
     * Enough to buy a few things and not enough to buy everything, so the
     * operator account can exercise the shop — including the state that
     * matters most, being short of what you want.
     */
    coins: 5_000,
  });
}

async function insertQuestions(originId, topicId, rows) {
  const docs = rows.map(([text, options, correctIndex, difficulty, explanation, art]) => ({
    origin: originId,
    topicIds: [topicId],
    content: { en: { text, options, explanation } },
    defaultLanguage: 'en',
    correctIndex,
    difficulty: difficulty ?? 'medium',
    ...(art ? { imageUrl: `mimo:art/${art}` } : {}),
    status: QUESTION_STATUS.PUBLISHED,
    contentHash: contentHashOf(text, options),
    source: 'manual',
    searchText: [text, ...options].join(' • '),
  }));
  await Question.insertMany(docs, { ordered: false });
  return docs.length;
}

async function seed() {
  await connectDb();

  console.log('\nSeeding Mimo — this DELETES everything first.\n');
  await wipe();

  /**
   * After the wipe, not before it.
   *
   * The old order built the indexes and then cleared the data, which happened
   * to survive `deleteMany` and does not survive a drop — the collections and
   * every index on them are gone by this point, so the schemas have to lay
   * them down again. A seed that finishes with an unindexed database is worse
   * than one that fails, because everything still works until the collections
   * are big enough to matter.
   */
  const { synced, failed } = await ensureIndexes();
  if (failed) throw new Error(`index sync failed on ${failed} model(s) — database left unindexed`);
  console.log(`  rebuilt indexes on ${synced} models`);

  /**
   * The public space is infrastructure, not seed data: every Category and
   * Topic below is required to name a `spaceId`, and the global catalogue
   * lives in this one. `wipe()` removes it along with everything else, so it
   * has to be put back before anything can reference it.
   */
  await ensurePublicSpace();

  /**
   * The progression config is infrastructure too: the cosmetics catalogue, the
   * account XP table, the league floors and the chests all become rows a
   * superadmin edits, and `wipe()` has just removed them.
   */
  const config = await loadProgression();
  // The two monthly chests are rolled from the catalogue rather than seeded
  // with fixed contents, so they have to be filled before anything can win one.
  const { period } = await ensureMonthlyChests();
  const withChests = await loadProgression({ seed: false, migrate: false });
  console.log(
    `  progression v${config.version} — ${config.catalogue.length} cosmetics, ` +
      `${withChests.chests.length} chests rolled for ${period}`,
  );

  await makeSuperadmin(SUPERADMIN);
  console.log('  1 superadmin');

  await makeDemoPlayer(config.accountCurve, config.catalogue);
  console.log(
    `  1 demo player — level ${config.accountCurve.length}, ` +
      `${DEMO_PLAYER.coins.toLocaleString('en-IN')} coins, every cosmetic owned`,
  );

  // ── Catalogue ────────────────────────────────────────────────────────────
  const categories = {};
  for (const [i, spec] of CATEGORIES.entries()) {
    categories[spec.name] = await Category.create({
      spaceId: publicSpaceId,
      name: spec.name,
      slug: slugify(spec.name),
      order: i,
      // The glyph, carried the same way an avatar preset is.
      iconUrl: `mimo:icon/${spec.icon}`,
      color: spec.color,
      status: 'active',
    });
  }
  console.log(`  ${CATEGORIES.length} categories`);

  const topics = [];
  let questionCount = 0;
  for (const spec of TOPICS) {
    const category = categories[spec.category];
    const iconKey = spec.icon ?? CATEGORIES.find((c) => c.name === spec.category).icon;
    const topic = await Topic.create({
      spaceId: publicSpaceId,
      categoryId: category._id,
      name: spec.name,
      slug: slugify(spec.name),
      description: spec.description,
      coverUrl: `mimo:icon/${iconKey}`,
      // PUBLISHED, not "LIVE" — there is no LIVE member on TOPIC_STATUS, and
      // referencing one yielded `undefined`, which silently took the schema
      // default of `draft` and left the whole catalogue unplayable.
      status: TOPIC_STATUS.PUBLISHED,
      languages: ['en'],
    });
    const n = await insertQuestions(publicSpaceId, topic._id, spec.bank);
    await Topic.updateOne({ _id: topic._id }, { $set: { publishedQuestionCount: n, questionCount: n } });
    topics.push(topic);
    questionCount += n;
  }
  console.log(`  ${topics.length} topics, ${questionCount} published questions`);

  console.log(
    `\nDone. OTP is 000000 for both:\n` +
      `  ${SUPERADMIN.phone}  the platform console\n` +
      `  ${DEMO_PLAYER.phone}  a player with the whole catalogue unlocked\n`,
  );

  await disconnectDb();
}

seed().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
