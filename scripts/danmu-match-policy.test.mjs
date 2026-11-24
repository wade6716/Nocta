import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDanmuSearchKeywords,
  evaluateDurationMatch,
  getMaxAcceptableDurationDiff,
  isHighConfidenceMatch,
  isLikelyExtraOrPreviewTitle,
  rankMatchingEpisodes,
  scoreMatchedCandidate,
  shouldTriggerStage2Fallback,
} from '../src/api/danmuMatchPolicy.ts';

test('getMaxAcceptableDurationDiff clamps between 90s and 300s across short, anime, drama, and movie durations', () => {
  assert.equal(getMaxAcceptableDurationDiff(600), 90);
  assert.equal(getMaxAcceptableDurationDiff(1440), 173);
  assert.equal(getMaxAcceptableDurationDiff(2700), 300);
  assert.equal(getMaxAcceptableDurationDiff(7200), 300);
  assert.equal(getMaxAcceptableDurationDiff(0), 180);
});

test('evaluateDurationMatch grades exact, acceptable, mismatch, and unknown durations accurately', () => {
  assert.equal(evaluateDurationMatch(1445, 1440).grade, 'exact');
  assert.equal(evaluateDurationMatch(1550, 1440).grade, 'acceptable');
  assert.equal(evaluateDurationMatch(2100, 1440).grade, 'mismatch');
  assert.equal(evaluateDurationMatch(undefined, 1440).grade, 'unknown');
  assert.equal(evaluateDurationMatch(1440, 0).grade, 'unknown');
});

test('shouldTriggerStage2Fallback triggers Stage 2 for 0 comments or severe duration mismatch', () => {
  const emptyCheck = shouldTriggerStage2Fallback({
    sourceDuration: 1440,
    videoDuration: 1440,
    commentCount: 0,
  });
  assert.equal(emptyCheck.shouldFallback, true);
  assert.equal(emptyCheck.reason, 'empty_comments');

  const mismatchCheck = shouldTriggerStage2Fallback({
    sourceDuration: 180,
    videoDuration: 2700,
    commentCount: 500,
  });
  assert.equal(mismatchCheck.shouldFallback, true);
  assert.equal(mismatchCheck.reason, 'duration_mismatch');

  const goodCheck = shouldTriggerStage2Fallback({
    sourceDuration: 1460,
    videoDuration: 1440,
    commentCount: 320,
  });
  assert.equal(goodCheck.shouldFallback, false);
  assert.equal(goodCheck.reason, undefined);
});

test('scoreMatchedCandidate ensures Stage 2 feature-length match beats Stage 1 preview/wrong-season mismatch, while Stage 1 stays as fallback if Stage 2 has no comments', () => {
  const wrongPreviewStage1 = scoreMatchedCandidate({
    sourceDuration: 180,
    videoDuration: 3600,
    commentCount: 400,
    episodeTitle: '第7集 抢先看预告',
    itemFileName: '现在就出发 第7集',
    animeScore: 120,
    isStage1: true,
  });

  const accurateStage2 = scoreMatchedCandidate({
    sourceDuration: 3585,
    videoDuration: 3600,
    commentCount: 850,
    episodeTitle: '第7集 正片',
    itemFileName: '现在就出发 第7集',
    animeScore: 100,
    isStage1: false,
  });

  assert.ok(
    accurateStage2 > wrongPreviewStage1,
    `expected accurate Stage 2 (${accurateStage2}) > wrong Stage 1 (${wrongPreviewStage1})`
  );

  const emptyStage2 = scoreMatchedCandidate({
    sourceDuration: 3590,
    videoDuration: 3600,
    commentCount: 0,
    episodeTitle: '第7集',
    animeScore: 100,
    isStage1: false,
  });
  const acceptableStage1 = scoreMatchedCandidate({
    sourceDuration: 3520,
    videoDuration: 3600,
    commentCount: 150,
    episodeTitle: '第7集',
    animeScore: 100,
    isStage1: true,
  });
  assert.ok(acceptableStage1 > emptyStage2);
  assert.equal(isHighConfidenceMatch({ sourceDuration: 180, videoDuration: 3600, commentCount: 400 }), false);
  assert.equal(isHighConfidenceMatch({ sourceDuration: 3585, videoDuration: 3600, commentCount: 400 }), true);
});

test('buildDanmuSearchKeywords generates deduplicated multi-variant keywords for seasons, subtitles, and mixed titles', () => {
  const kw1 = buildDanmuSearchKeywords({
    seriesName: '鬼灭之刃：柱训练篇 (2024) 1080p',
    seasonNumber: 4,
    isMovie: false,
  });
  assert.deepEqual(kw1, [
    '鬼灭之刃：柱训练篇',
    '鬼灭之刃：柱训练篇 第四季',
    '鬼灭之刃',
    '鬼灭之刃：柱训练篇 (2024) 1080p',
  ]);

  const kw2 = buildDanmuSearchKeywords({
    seriesName: '三体 Three-Body',
    seasonNumber: 1,
    isMovie: false,
  });
  assert.deepEqual(kw2, ['三体 Three-Body', '三体']);
});

test('rankMatchingEpisodes prioritizes main feature over extra/add-on episodes and matches part markers', () => {
  const mockParse = (ep) => {
    const plat = ep.episodeTitle.match(/^【([^】]+)】/)?.[1];
    const num = Number(ep.episodeTitle.match(/第(\d+)集/)?.[1]);
    return {
      platform: plat,
      cleanTitle: ep.episodeTitle,
      episodeNumber: Number.isFinite(num) ? num : undefined,
      subTitle: ep.episodeTitle,
    };
  };

  const episodes = [
    { episodeId: '1', episodeTitle: '【qq】第7集 加更：沈腾王安宇游戏局' },
    { episodeId: '2', episodeTitle: '【bilibili1】第7集 正片：古城寻宝上' },
    { episodeId: '3', episodeTitle: '【qq】第7集 上：古城寻宝' },
    { episodeId: '4', episodeTitle: '【qq】第7集 下：森林营地' },
  ];

  const rankedForPartDown = rankMatchingEpisodes(episodes, mockParse, {
    episodeNumber: 7,
    preferredPlatform: 'qq',
    itemFileName: '第7集 下：森林营地',
    limit: 3,
  });
  assert.equal(rankedForPartDown[0].episodeId, '4');
  assert.ok(!isLikelyExtraOrPreviewTitle(rankedForPartDown[0].episodeTitle));
  assert.ok(isLikelyExtraOrPreviewTitle(episodes[0].episodeTitle));

  const rankedForMain = rankMatchingEpisodes(episodes, mockParse, {
    episodeNumber: 7,
    preferredPlatform: 'qq',
    itemFileName: '第7集',
    limit: 3,
  });
  assert.notEqual(rankedForMain[0].episodeId, '1');
});
