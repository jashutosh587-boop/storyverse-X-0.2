/**
 * TEST FIXTURES. Hand-written to follow each provider's documented response
 * shape. They were NOT captured from the live APIs (the build environment has
 * no access to them), and their values are illustrative. They exist to test
 * parsing and normalization and are never loaded into a real catalog.
 */

export const jikanAnimeTv = {
  mal_id: 1,
  url: 'https://myanimelist.net/anime/1/Cowboy_Bebop',
  images: {
    jpg: { image_url: 'https://cdn.myanimelist.net/images/anime/4/19644.jpg', large_image_url: 'https://cdn.myanimelist.net/images/anime/4/19644l.jpg' },
    webp: { image_url: 'https://cdn.myanimelist.net/images/anime/4/19644.webp', large_image_url: 'https://cdn.myanimelist.net/images/anime/4/19644l.webp' },
  },
  titles: [
    { type: 'Default', title: 'Cowboy Bebop' },
    { type: 'Japanese', title: 'カウボーイビバップ' },
    { type: 'English', title: 'Cowboy Bebop' },
    { type: 'Synonym', title: 'CB' },
    { type: 'French', title: 'Cowboy Bebop (FR)' },
  ],
  title: 'Cowboy Bebop',
  title_english: 'Cowboy Bebop',
  title_japanese: 'カウボーイビバップ',
  type: 'TV',
  episodes: 26,
  status: 'Finished Airing',
  aired: { from: '1998-04-03T00:00:00+00:00', to: '1999-04-24T00:00:00+00:00' },
  duration: '24 min per ep',
  rating: 'R - 17+ (violence & profanity)',
  score: 8.75,
  scored_by: 1_000_000,
  members: 1_900_000,
  synopsis: 'Fixture synopsis for parsing tests.',
  season: 'spring',
  year: 1998,
  producers: [{ mal_id: 23, type: 'anime', name: 'Bandai Visual' }],
  studios: [{ mal_id: 14, type: 'anime', name: 'Sunrise' }],
  genres: [
    { mal_id: 1, name: 'Action' },
    { mal_id: 24, name: 'Sci-Fi' },
  ],
  themes: [{ mal_id: 29, name: 'Space' }],
  demographics: [],
};

export const jikanAnimeMovie = {
  mal_id: 5,
  url: 'https://myanimelist.net/anime/5/Cowboy_Bebop__Tengoku_no_Tobira',
  images: { jpg: { image_url: 'https://cdn.myanimelist.net/img/sp/icon/apple-touch-icon-256.png' } },
  titles: [{ type: 'Default', title: 'Cowboy Bebop: Tengoku no Tobira' }],
  title: 'Cowboy Bebop: Tengoku no Tobira',
  type: 'Movie',
  episodes: 1,
  status: 'Finished Airing',
  aired: { from: '2001-09-01T00:00:00+00:00', to: null },
  duration: '1 hr 55 min',
  score: 0,
  scored_by: null,
  members: 400_000,
  synopsis: null,
  season: null,
  year: null,
  studios: [{ mal_id: 14, name: 'Bones' }],
  genres: [{ mal_id: 1, name: 'Action' }],
  themes: [],
};

export const jikanManga = {
  mal_id: 2,
  url: 'https://myanimelist.net/manga/2/Berserk',
  images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/images/manga/1/157897l.jpg' } },
  titles: [
    { type: 'Default', title: 'Berserk' },
    { type: 'Japanese', title: 'ベルセルク' },
  ],
  title: 'Berserk',
  title_japanese: 'ベルセルク',
  type: 'Manga',
  chapters: null,
  volumes: 42,
  status: 'On Hiatus',
  published: { from: '1989-08-25T00:00:00+00:00', to: null },
  score: 9.47,
  scored_by: 400_000,
  members: 700_000,
  synopsis: 'Fixture synopsis for a manga.',
  authors: [{ mal_id: 1868, type: 'people', name: 'Miura, Kentarou' }],
  genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 10, name: 'Fantasy' }],
  themes: [{ mal_id: 14, name: 'Gore' }],
  demographics: [{ mal_id: 41, name: 'Seinen' }],
};

export const jikanRelations = {
  data: [
    { relation: 'Adaptation', entry: [{ mal_id: 173, type: 'manga', name: 'Cowboy Bebop: Shooting Star' }] },
    { relation: 'Sequel', entry: [{ mal_id: 5, type: 'anime', name: 'Cowboy Bebop: Tengoku no Tobira' }] },
    { relation: 'Spin-off', entry: [{ mal_id: 99, type: 'anime', name: 'A Spin-off' }] },
    { relation: 'Other', entry: [{ mal_id: 7, type: 'anime', name: 'Something Else' }] },
    { relation: 'Mystery Label', entry: [{ mal_id: 8, type: 'anime', name: 'Unknown Kind' }] },
    { relation: 'Character', entry: [{ mal_id: 3, type: 'people', name: 'Not a title' }] },
  ],
};

export const tmdbMovie = {
  id: 78,
  title: 'Blade Runner',
  original_title: 'Blade Runner',
  overview: 'Fixture overview for a movie.',
  release_date: '1982-06-25',
  runtime: 117,
  status: 'Released',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  vote_average: 7.9,
  vote_count: 14_000,
  popularity: 45.3,
  original_language: 'en',
  production_countries: [{ iso_3166_1: 'US' }],
  genres: [
    { id: 878, name: 'Science Fiction' },
    { id: 53, name: 'Thriller' },
  ],
  credits: {
    cast: [
      { id: 3, name: 'Second Billed', order: 1 },
      { id: 2, name: 'First Billed', order: 0 },
    ],
    crew: [
      { id: 9, name: 'A Director', job: 'Director' },
      { id: 10, name: 'A Producer', job: 'Producer' },
    ],
  },
};

export const tmdbTv = {
  id: 1396,
  name: 'A Fixture Series',
  original_name: 'Eine Fixture-Serie',
  overview: '',
  first_air_date: '2008-01-20',
  last_air_date: '2013-09-29',
  status: 'Ended',
  number_of_episodes: 62,
  episode_run_time: [47],
  origin_country: ['US'],
  original_language: 'en',
  poster_path: null,
  backdrop_path: null,
  vote_average: 0,
  vote_count: 0,
  popularity: 10,
  genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 18, name: 'Drama' }],
  created_by: [{ id: 66633, name: 'A Creator' }],
};

export const tmdbDiscover = {
  page: 1,
  total_pages: 3,
  results: [{ id: 78 }, { id: 999999 }],
};

export const openLibraryDoc = {
  key: '/works/OL893415W',
  title: 'Dune',
  author_name: ['Frank Herbert'],
  author_key: ['OL79034A'],
  first_publish_year: 1965,
  subject: [
    'Science fiction',
    'Fiction',
    'Politics',
    'Accessible book',
    'Protected DAISY',
    'in library',
    'a very long subject name that goes on and on and on and on and on and on and on',
    'space flight',
  ],
  cover_i: 12345,
  number_of_pages_median: 604,
  language: ['eng', 'fre'],
  ratings_average: 4.2,
  ratings_count: 1500,
  edition_count: 300,
};
