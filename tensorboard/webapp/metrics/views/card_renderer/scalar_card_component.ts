/* Copyright 2020 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
import {ComponentType} from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {DataLoadState} from '../../../types/data';
import {
  TimeSelection,
  TimeSelectionAffordance,
  TimeSelectionToggleAffordance,
  TimeSelectionWithAffordance,
} from '../../../widgets/card_fob/card_fob_types';
import {
  Formatter,
  intlNumberFormatter,
  numberFormatter,
  relativeTimeFormatter,
  siNumberFormatter,
} from '../../../widgets/line_chart_v2/lib/formatter';
import {LineChartComponent} from '../../../widgets/line_chart_v2/line_chart_component';
import {
  RendererType,
  ScaleType,
  TooltipDatum,
} from '../../../widgets/line_chart_v2/types';
import {TooltipSort, XAxisType} from '../../types';
import {
  ColumnHeaders,
  MinMaxStep,
  ScalarCardDataSeries,
  ScalarCardSeriesMetadata,
  ScalarCardSeriesMetadataMap,
} from './scalar_card_types';
import {TimeSelectionView} from './utils';

type ScalarTooltipDatum = TooltipDatum<
  ScalarCardSeriesMetadata & {
    distSqToCursor: number;
    closest: boolean;
  }
>;

@Component({
  selector: 'scalar-card-component',
  templateUrl: 'scalar_card_component.ng.html',
  styleUrls: ['scalar_card_component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScalarCardComponent<Downloader> {
  readonly DataLoadState = DataLoadState;
  readonly RendererType = RendererType;
  readonly ScaleType = ScaleType;

  @Input() cardId!: string;
  @Input() chartMetadataMap!: ScalarCardSeriesMetadataMap;
  @Input() DataDownloadComponent!: ComponentType<Downloader>;
  @Input() dataSeries!: ScalarCardDataSeries[];
  @Input() ignoreOutliers!: boolean;
  @Input() isCardVisible!: boolean;
  @Input() isPinned!: boolean;
  @Input() loadState!: DataLoadState;
  @Input() showFullSize!: boolean;
  @Input() smoothingEnabled!: boolean;
  @Input() tag!: string;
  @Input() title!: string;
  @Input() tooltipSort!: TooltipSort;
  @Input() xAxisType!: XAxisType;
  @Input() xScaleType!: ScaleType;
  @Input() useDarkMode!: boolean;
  @Input() forceSvg!: boolean;
  @Input() linkedTimeSelection!: TimeSelectionView | null;
  @Input() stepSelectorTimeSelection!: TimeSelection;
  @Input() minMaxStep!: MinMaxStep;
  @Input() dataHeaders!: ColumnHeaders[];

  @Output() onFullSizeToggle = new EventEmitter<void>();
  @Output() onPinClicked = new EventEmitter<boolean>();
  @Output() onLinkedTimeToggled =
    new EventEmitter<TimeSelectionToggleAffordance>();
  @Output() onTimeSelectionChanged = new EventEmitter<{
    timeSelection: TimeSelection;
    affordance?: TimeSelectionAffordance;
  }>();
  @Output() onStepSelectorToggled =
    new EventEmitter<TimeSelectionToggleAffordance>();

  // Line chart may not exist when was never visible (*ngIf).
  @ViewChild(LineChartComponent)
  lineChart?: LineChartComponent;

  constructor(private readonly ref: ElementRef, private dialog: MatDialog) {}

  yScaleType = ScaleType.LINEAR;
  isViewBoxOverridden: boolean = false;

  toggleYScaleType() {
    this.yScaleType =
      this.yScaleType === ScaleType.LINEAR ? ScaleType.LOG10 : ScaleType.LINEAR;
  }

  resetDomain() {
    if (this.lineChart) {
      this.lineChart.viewBoxReset();
    }
  }

  trackByTooltipDatum(index: number, datum: ScalarTooltipDatum) {
    return datum.id;
  }

  readonly relativeXFormatter = relativeTimeFormatter;
  readonly valueFormatter = numberFormatter;
  readonly stepFormatter = intlNumberFormatter;

  getCustomXFormatter(): Formatter | undefined {
    switch (this.xAxisType) {
      case XAxisType.RELATIVE:
        return relativeTimeFormatter;
      case XAxisType.STEP:
        return siNumberFormatter;
      case XAxisType.WALL_TIME:
      default:
        return undefined;
    }
  }

  getCursorAwareTooltipData(
    tooltipData: TooltipDatum<ScalarCardSeriesMetadata>[],
    cursorLoc: {x: number; y: number}
  ): ScalarTooltipDatum[] {
    const scalarTooltipData = tooltipData.map((datum) => {
      return {
        ...datum,
        metadata: {
          ...datum.metadata,
          closest: false,
          distSqToCursor: Math.hypot(
            datum.point.x - cursorLoc.x,
            datum.point.y - cursorLoc.y
          ),
        },
      };
    });

    let minDist = Infinity;
    let minIndex = 0;
    for (let index = 0; index < scalarTooltipData.length; index++) {
      if (minDist > scalarTooltipData[index].metadata.distSqToCursor) {
        minDist = scalarTooltipData[index].metadata.distSqToCursor;
        minIndex = index;
      }
    }

    if (scalarTooltipData.length) {
      scalarTooltipData[minIndex].metadata.closest = true;
    }

    switch (this.tooltipSort) {
      case TooltipSort.ASCENDING:
        return scalarTooltipData.sort((a, b) => a.point.y - b.point.y);
      case TooltipSort.DESCENDING:
        return scalarTooltipData.sort((a, b) => b.point.y - a.point.y);
      case TooltipSort.NEAREST:
        return scalarTooltipData.sort((a, b) => {
          return a.metadata.distSqToCursor - b.metadata.distSqToCursor;
        });
      case TooltipSort.DEFAULT:
      case TooltipSort.ALPHABETICAL:
        return scalarTooltipData.sort((a, b) => {
          if (a.metadata.displayName < b.metadata.displayName) {
            return -1;
          }
          if (a.metadata.displayName > b.metadata.displayName) {
            return 1;
          }
          return 0;
        });
    }
  }

  openDataDownloadDialog(): void {
    this.dialog.open(this.DataDownloadComponent, {
      data: {cardId: this.cardId},
    });
  }

  getTimeSelection(): TimeSelection | null {
    if (this.linkedTimeSelection === null) {
      return this.stepSelectorTimeSelection;
    }

    return {
      start: {
        step: this.linkedTimeSelection.startStep,
      },
      end: this.linkedTimeSelection.endStep
        ? {step: this.linkedTimeSelection.endStep}
        : null,
    };
  }

  onFobTimeSelectionChanged(
    newTimeSelectionWithAffordance: TimeSelectionWithAffordance
  ) {
    // Updates step selector to single selection.
    const {timeSelection, affordance} = newTimeSelectionWithAffordance;
    const newStartStep = timeSelection.start.step;
    const nextStartStep =
      newStartStep < this.minMaxStep.minStep
        ? this.minMaxStep.minStep
        : newStartStep > this.minMaxStep.maxStep
        ? this.minMaxStep.maxStep
        : newStartStep;

    // Updates step selector to single selection.
    this.stepSelectorTimeSelection = {
      start: {step: nextStartStep},
      end: null,
    };

    this.onTimeSelectionChanged.emit({
      timeSelection,
      // Only sets affordance when it's not undefined.
      ...(affordance && {affordance}),
    });
  }

  onFobRemoved() {
    if (this.linkedTimeSelection !== null) {
      this.onLinkedTimeToggled.emit(TimeSelectionToggleAffordance.FOB_DESELECT);
    } else {
      this.onStepSelectorToggled.emit(
        TimeSelectionToggleAffordance.FOB_DESELECT
      );
    }
  }

  inTimeSelectionMode(): boolean {
    return (
      this.xAxisType === XAxisType.STEP &&
      (this.stepSelectorTimeSelection !== null ||
        this.linkedTimeSelection !== null)
    );
  }
}
