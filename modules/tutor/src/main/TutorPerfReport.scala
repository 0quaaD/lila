package lila.tutor

import chess.{ ByColor, Color }

import lila.analyse.AccuracyPercent
import lila.common.LilaOpeningFamily
import lila.insight.*
import lila.rating.PerfType
import lila.tutor.TutorCompare.AnyComparison
import lila.tutor.TutorCompare.Comparison

// for simplicity, all metrics should be positive: higher is better
case class TutorPerfReport(
    perf: PerfType,
    stats: InsightPerfStats,
    accuracy: TutorBothValueOptions[AccuracyPercent],
    awareness: TutorBothValueOptions[GoodPercent],
    resourcefulness: TutorBothValueOptions[GoodPercent],
    conversion: TutorBothValueOptions[GoodPercent],
    globalClock: TutorBothValueOptions[ClockPercent],
    clockUsage: TutorBothValueOptions[ClockPercent],
    openings: ByColor[TutorColorOpenings],
    phases: List[TutorPhase],
    flagging: TutorFlagging
):
  lazy val estimateTotalTime: Option[FiniteDuration] = (perf != PerfType.Correspondence) option stats.time * 2

  // Dimension comparison is not interesting for phase accuracy (opening always better)
  // But peer comparison is gold
  lazy val phaseAccuracyCompare = TutorCompare[Phase, AccuracyPercent](
    InsightDimension.Phase,
    TutorMetric.Accuracy,
    phases.map { phase => (phase.phase, phase.accuracy) }
  )

  lazy val phaseAwarenessCompare = TutorCompare[Phase, GoodPercent](
    InsightDimension.Phase,
    TutorMetric.Awareness,
    phases.map { phase => (phase.phase, phase.awareness) }
  )

  lazy val globalAccuracyCompare = TutorCompare[PerfType, AccuracyPercent](
    InsightDimension.Perf,
    TutorMetric.Accuracy,
    List((perf, accuracy))
  )

  lazy val globalAwarenessCompare = TutorCompare[PerfType, GoodPercent](
    InsightDimension.Perf,
    TutorMetric.Awareness,
    List((perf, awareness))
  )

  lazy val globalResourcefulnessCompare = TutorCompare[PerfType, GoodPercent](
    InsightDimension.Perf,
    TutorMetric.Resourcefulness,
    List((perf, resourcefulness))
  )

  lazy val globalConversionCompare = TutorCompare[PerfType, GoodPercent](
    InsightDimension.Perf,
    TutorMetric.Conversion,
    List((perf, conversion))
  )

  lazy val globalPressureCompare = TutorCompare[PerfType, ClockPercent](
    InsightDimension.Perf,
    TutorMetric.GlobalClock,
    List((perf, globalClock))
  )

  lazy val timeUsageCompare = TutorCompare[PerfType, ClockPercent](
    InsightDimension.Perf,
    TutorMetric.ClockUsage,
    List((perf, clockUsage))
  )

  // lazy val flaggingCompare = TutorCompare[PerfType, ClockPercent](
  //   InsightDimension.Perf,
  //   TutorMetric.Flagging,
  //   List((perf, flagging))
  // )

  def skillCompares =
    List(globalAccuracyCompare, globalAwarenessCompare, globalResourcefulnessCompare, globalConversionCompare)

  def phaseCompares = List(phaseAccuracyCompare, phaseAwarenessCompare)

  val clockCompares = List(globalPressureCompare, timeUsageCompare)

  def openingCompares: List[TutorCompare[LilaOpeningFamily, ?]] = Color.all.flatMap: color =>
    val op = openings(color)
    List(op.accuracyCompare, op.awarenessCompare, op.performanceCompare).map(_ as color)

  lazy val allCompares: List[TutorCompare[?, ?]] = openingCompares ::: phaseCompares

  val skillHighlights = TutorCompare.mixedBag(skillCompares.flatMap(_.peerComparisons))

  val openingHighlights = TutorCompare.mixedBag(openingCompares.flatMap(_.allComparisons))

  val phaseHighlights = TutorCompare.mixedBag(phaseCompares.flatMap(_.peerComparisons))

  val timeHighlights = TutorCompare.mixedBag(clockCompares.flatMap(_.peerComparisons))

  val relevantComparisons: List[AnyComparison] =
    openingCompares.flatMap(_.allComparisons) :::
      phaseCompares.flatMap(_.peerComparisons) :::
      clockCompares.flatMap(_.peerComparisons) :::
      skillCompares.flatMap(_.peerComparisons)
  val relevantHighlights = TutorCompare.mixedBag(relevantComparisons)

  def openingFrequency(color: Color, fam: TutorOpeningFamily) =
    GoodPercent(fam.performance.mine.count, stats.nbGames(color))

private object TutorPerfReport:

  // just an optimization. If a similar report (date, rating) exists,
  // we reuse its peers data instead of recomputing it
  case class PeerMatch(report: TutorPerfReport):
    export report.*

  import TutorBuilder.*

  private val accuracyQuestion  = Question(InsightDimension.Perf, InsightMetric.MeanAccuracy)
  private val awarenessQuestion = Question(InsightDimension.Perf, InsightMetric.Awareness)
  private val globalClockQuestion = Question(
    InsightDimension.Perf,
    InsightMetric.ClockPercent,
    List(Filter(InsightDimension.Phase, List(Phase.Middle, Phase.End)))
  )

  def compute(user: TutorUser)(using InsightApi, Executor): Fu[TutorPerfReport] =
    for
      accuracy        <- answerBoth(accuracyQuestion, user)
      awareness       <- answerBoth(awarenessQuestion, user)
      resourcefulness <- TutorResourcefulness compute user
      conversion      <- TutorConversion compute user
      hasClock = user.perfType != PerfType.Correspondence
      globalClock <- hasClock soFu answerBoth(globalClockQuestion, user)
      clockUsage  <- hasClock soFu TutorClockUsage.compute(user)
      openings    <- TutorOpening compute user
      phases      <- TutorPhases compute user
      flagging    <- hasClock so TutorFlagging.compute(user)
    yield TutorPerfReport(
      user.perfType,
      user.perfStats,
      accuracy = AccuracyPercent.from(accuracy valueMetric user.perfType),
      awareness = GoodPercent.from(awareness valueMetric user.perfType),
      resourcefulness = GoodPercent.from(resourcefulness),
      conversion = GoodPercent.from(conversion),
      globalClock = ClockPercent.from(globalClock.so(_ valueMetric user.perfType)),
      clockUsage = ClockPercent.from(clockUsage),
      openings,
      phases,
      flagging
    )
