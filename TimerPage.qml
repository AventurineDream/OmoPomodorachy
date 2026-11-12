import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui

Item {
  id: root

  property var timerService: null
  property color foreground: Color.popups.text
  property color activeColor: Color.accent
  property string fontFamily: Style.font.family
  property string progressBarStyle: "linear"
  property bool updateAvailable: false
  property bool cursorActive: false
  property int selectedAction: 0
  property bool resetVisible: false
  property bool addTimeVisible: false
  property bool hasSessionData: false
  property int totalActionCount: 2

  signal updateRequested
  signal infoRequested
  signal actionHovered(int index, bool hovered)

  width: parent.width
  height: contentColumn.implicitHeight

  Column {
    id: contentColumn
    width: parent.width
    spacing: Style.space(18)

    Column {
      visible: root.updateAvailable
      width: parent.width
      spacing: Style.space(8)

      RowLayout {
        width: parent.width
        spacing: Style.space(8)

        Text {
          text: ""
          color: root.activeColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          text: "Update available"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Item {
          Layout.fillWidth: true
          implicitHeight: 1
        }

        Button {
          text: "Update"
          iconText: "󰚰"
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          hasCursor: root.cursorActive && root.selectedAction === root.totalActionCount - 1
          onHovered: function (value) {
            root.actionHovered(root.totalActionCount - 1, value);
          }
          onClicked: root.updateRequested()
        }
      }

      Rectangle {
        width: parent.width
        height: 1
        color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
      }
    }

    LinearFace {
      width: parent.width
      visible: root.progressBarStyle !== "circular"
      timerService: root.timerService
      foreground: root.foreground
      activeColor: root.activeColor
      fontFamily: root.fontFamily
    }

    CircularFace {
      width: parent.width
      visible: root.progressBarStyle === "circular"
      timerService: root.timerService
      foreground: root.foreground
      activeColor: root.activeColor
      fontFamily: root.fontFamily
    }

    SessionDots {
      visible: root.hasSessionData
      anchors.horizontalCenter: parent.horizontalCenter
      timerService: root.timerService
      foreground: root.foreground
      activeColor: root.activeColor
    }

    Column {
      width: parent.width
      spacing: Style.space(10)

      Row {
        width: parent.width
        spacing: Style.space(20)

        Column {
          width: (parent.width - parent.spacing) / 2
          spacing: Style.spacing.labelGap
          InfoPair {
            icon: ""
            label: "Streak"
            value: (root.timerService ? root.timerService.currentStreak : 0) + "d"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }
          InfoPair {
            icon: "󰓾"
            label: "Goal"
            value: root.timerService ? root.timerService.dailyGoal : "—"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }
        }

        Column {
          width: (parent.width - parent.spacing) / 2
          spacing: Style.spacing.labelGap
          InfoPair {
            icon: ""
            label: "Sessions today"
            value: root.timerService ? String(root.timerService.sessionsToday) : "0"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }
          InfoPair {
            icon: "󰔟"
            label: "Focused today"
            value: root.timerService ? root.timerService.focusedToday : "—"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }
        }
      }

      Text {
        visible: root.timerService ? root.timerService.rounds > 0 : false
        text: root.timerService ? ("Rounds: " + root.timerService.roundsCompleted + " / " + root.timerService.rounds + " done") : ""
        color: root.foreground
        opacity: 0.6
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }

    Row {
      id: actions
      anchors.horizontalCenter: parent.horizontalCenter
      spacing: Style.space(10)
      readonly property real buttonSize: Style.space(42)

      Button {
        id: pauseButton
        implicitWidth: actions.buttonSize
        implicitHeight: actions.buttonSize
        width: actions.buttonSize
        height: actions.buttonSize
        iconText: root.timerService && root.timerService.paused ? "󰐊" : "󰏤"
        tooltipText: root.timerService && root.timerService.paused ? "Resume session" : "Pause session"
        foreground: root.foreground
        accent: root.activeColor
        iconSize: Style.font.iconLarge + 4
        horizontalPadding: 0
        verticalPadding: 0
        enabled: !!root.timerService && !root.timerService.stopped
        opacity: enabled ? 1 : 0.35
        hasCursor: root.cursorActive && root.selectedAction === 0
        onHovered: function (value) {
          root.actionHovered(0, value);
        }
        onClicked: if (root.timerService)
          root.timerService.togglePause()
      }

      Button {
        id: skipButton
        implicitWidth: actions.buttonSize
        implicitHeight: actions.buttonSize
        width: actions.buttonSize
        height: actions.buttonSize
        iconText: ""
        tooltipText: "Skip to " + (root.timerService ? root.timerService.nextSessionLabel : "next session")
        foreground: root.foreground
        accent: root.activeColor
        iconSize: Style.font.iconLarge
        horizontalPadding: 0
        verticalPadding: 0
        enabled: !!root.timerService && !root.timerService.stopped
        opacity: enabled ? 1 : 0.35
        hasCursor: root.cursorActive && root.selectedAction === 1
        onHovered: function (value) {
          root.actionHovered(1, value);
        }
        onClicked: if (root.timerService)
          root.timerService.skip()
      }

      Button {
        id: resetButton
        visible: root.resetVisible
        implicitWidth: actions.buttonSize
        implicitHeight: actions.buttonSize
        width: actions.buttonSize
        height: actions.buttonSize
        iconText: ""
        tooltipText: "Reset session"
        foreground: root.foreground
        accent: root.activeColor
        iconSize: Style.font.iconLarge
        horizontalPadding: 0
        verticalPadding: 0
        enabled: root.resetVisible
        opacity: enabled ? 1 : 0.35
        hasCursor: root.cursorActive && root.selectedAction === 2
        onHovered: function (value) {
          root.actionHovered(2, value);
        }
        onClicked: if (root.timerService)
          root.timerService.stop()
      }

      Button {
        id: addTimeButton
        visible: root.addTimeVisible
        implicitWidth: actions.buttonSize
        implicitHeight: actions.buttonSize
        width: actions.buttonSize
        height: actions.buttonSize
        iconText: ""
        tooltipText: "Add 5 minutes"
        foreground: root.foreground
        accent: root.activeColor
        iconSize: Style.font.iconLarge
        horizontalPadding: 0
        verticalPadding: 0
        enabled: root.addTimeVisible
        opacity: enabled ? 1 : 0.35
        hasCursor: root.cursorActive && root.selectedAction === (root.resetVisible ? 3 : 2) && root.addTimeVisible
        onHovered: function (value) {
          root.actionHovered(root.resetVisible ? 3 : 2, value);
        }
        onClicked: if (root.timerService)
          root.timerService.addMinutes(5)
      }
    }

    // Durations: sliders for the active preset's work / break lengths.
    // A change is written to focusd's config.toml on release and takes
    // effect from the next session of that type.
    Column {
      width: parent.width
      spacing: Style.space(10)

      Rectangle {
        width: parent.width
        height: 1
        color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
      }

      RowLayout {
        width: parent.width
        spacing: Style.space(8)

        Text {
          text: "Durations"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Item {
          Layout.fillWidth: true
          implicitHeight: 1
        }

        Text {
          text: root.timerService ? ("Preset: " + root.timerService.activePreset) : ""
          color: root.foreground
          opacity: 0.6
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }

      DurationRow {
        label: "Work"
        minimum: 5
        maximum: 90
        minutes: root.timerService ? root.timerService.workMinutes : 25
        onReleased: function (v) {
          if (root.timerService)
            root.timerService.writeDurations("work", v);
        }
      }

      DurationRow {
        label: "Short break"
        minimum: 1
        maximum: 30
        minutes: root.timerService ? root.timerService.shortBreakMinutes : 5
        onReleased: function (v) {
          if (root.timerService)
            root.timerService.writeDurations("shortBreak", v);
        }
      }

      DurationRow {
        label: "Long break"
        minimum: 5
        maximum: 60
        minutes: root.timerService ? root.timerService.longBreakMinutes : 15
        onReleased: function (v) {
          if (root.timerService)
            root.timerService.writeDurations("longBreak", v);
        }
      }

      // Rounds: how many work sessions run before the timer stops.
      // 0 is off — run without a limit. Written to focusd.json on release.
      DurationRow {
        label: "Rounds"
        minimum: 0
        maximum: 12
        minutes: root.timerService ? root.timerService.rounds : 0
        suffix: ""
        zeroText: "off"
        onReleased: function (v) {
          if (root.timerService)
            root.timerService.writeRounds(v);
        }
      }

      Text {
        text: "Applies from the next session of that type. Rounds: 0 is off."
        color: root.foreground
        opacity: 0.5
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }

    // Block tagging: pick a category for the next/current work block,
    // and fix the tag of the block that just ended.
    Column {
      width: parent.width
      spacing: Style.space(10)

      Rectangle {
        width: parent.width
        height: 1
        color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
      }

      Text {
        text: "Tag this block"
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Flow {
        width: parent.width
        spacing: Style.space(8)

        Repeater {
          model: root.timerService ? root.timerService.tags : []

          Button {
            required property string modelData
            text: modelData
            foreground: root.foreground
            accent: root.activeColor
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            // The selected tag reads as the active one.
            opacity: root.timerService && root.timerService.currentTag === modelData ? 1 : 0.55
            onClicked: if (root.timerService)
              root.timerService.setCurrentTag(modelData)
          }
        }
      }

      Row {
        visible: root.timerService ? !!root.timerService.lastWorkSession : false
        width: parent.width
        spacing: Style.space(8)

        Text {
          text: "Last:"
          color: root.foreground
          opacity: 0.6
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Button {
          text: root.timerService && root.timerService.lastWorkSession ? root.timerService.lastWorkSession.tag : ""
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: if (root.timerService)
            root.timerService.cycleLastTag()
        }

        Text {
          text: root.timerService && root.timerService.lastWorkSession ? ("· " + root.timerService.lastWorkSession.minutes + " min · " + root.timerService.lastWorkSession.date) : ""
          color: root.foreground
          opacity: 0.6
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }

      Text {
        text: "Tags the next work block. Tap Last to fix the one that just ended."
        color: root.foreground
        opacity: 0.5
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
        // Leave room for the info button in the panel's bottom-right corner.
        width: parent.width - Style.space(36)
      }
    }
  }

  Item {
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    width: Style.space(28)
    height: Style.space(28)

    Button {
      anchors.right: parent.right
      implicitWidth: Style.space(28)
      implicitHeight: Style.space(28)
      iconText: ""
      tooltipText: "Info and settings"
      foreground: root.foreground
      accent: root.activeColor
      iconSize: Style.font.body
      horizontalPadding: 0
      verticalPadding: 0
      hasCursor: root.cursorActive && root.selectedAction === root.totalActionCount - (root.updateAvailable ? 2 : 1)
      onHovered: function (value) {
        root.actionHovered(root.totalActionCount - (root.updateAvailable ? 2 : 1), value);
      }
      onClicked: root.infoRequested()
    }
  }

  component InfoPair: Row {
    property string icon: ""
    property string label: ""
    property string value: ""
    property color foreground: Color.popups.text
    property string fontFamily: Style.font.family

    width: parent.width
    spacing: Style.space(8)

    Text {
      id: iconText
      visible: icon !== ""
      text: icon
      color: foreground
      opacity: 0.6
      font.family: fontFamily
      font.pixelSize: Style.font.bodySmall
    }
    InfoLabel {
      text: label
      foreground: parent.foreground
      fontFamily: parent.fontFamily
    }
    Item {
      width: Math.max(0, parent.width - parent.children[0].implicitWidth - parent.children[1].implicitWidth - parent.children[3].implicitWidth - parent.spacing * 3)
      height: 1
    }
    InfoValue {
      text: value
      foreground: parent.foreground
      fontFamily: parent.fontFamily
    }
  }

  component InfoLabel: Text {
    property color foreground: Color.popups.text
    property string fontFamily: Style.font.family

    color: foreground
    opacity: 0.6
    font.family: fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  component InfoValue: Text {
    property color foreground: Color.popups.text
    property string fontFamily: Style.font.family

    color: foreground
    font.family: fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  component DurationRow: RowLayout {
    property string label: ""
    property int minimum: 1
    property int maximum: 60
    property int minutes: 0
    // Suffix for the value text (" min" for durations). zeroText, when
    // set, is shown instead when the value is 0 (the Rounds slider uses
    // it for "off").
    property string suffix: " min"
    property string zeroText: ""

    signal released(real value)

    width: parent.width
    spacing: Style.space(8)

    Text {
      text: label
      color: root.foreground
      opacity: 0.7
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      Layout.preferredWidth: Style.space(78)
    }

    PanelSlider {
      id: durationSlider
      Layout.fillWidth: true
      minimum: parent.minimum
      maximum: parent.maximum
      step: 1
      integer: true
      value: parent.minutes
      fillColor: root.activeColor
      knobColor: root.foreground
      onReleased: function (v) { parent.released(v) }
    }

    Text {
      text: (parent.zeroText && Math.round(durationSlider.liveValue) === 0) ? parent.zeroText : (Math.round(durationSlider.liveValue) + parent.suffix)
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      Layout.preferredWidth: Style.space(52)
      horizontalAlignment: Text.AlignRight
    }
  }

  component LinearFace: Column {
    property var timerService: null
    property color foreground: Color.popups.text
    property color activeColor: Color.accent
    property string fontFamily: Style.font.family

    width: parent.width
    spacing: Style.space(12)

    Item {
      width: parent.width
      implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, heroTime.implicitHeight)

      Text {
        id: heroIcon
        text: timerService ? timerService.icon : ""
        color: foreground
        font.family: fontFamily
        font.pixelSize: Style.font.display
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
      }

      Column {
        id: heroLabels
        anchors.left: heroIcon.right
        anchors.leftMargin: Style.space(14)
        anchors.right: heroTime.left
        anchors.rightMargin: Style.space(10)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(2)

        Text {
          text: timerService ? timerService.sessionLabel : "Work"
          color: foreground
          font.family: fontFamily
          font.pixelSize: Style.font.title
          font.bold: true
          elide: Text.ElideRight
          width: parent.width
        }

        Text {
          text: (timerService && timerService.paused ? "Paused" : timerService && timerService.running ? "Running" : "Stopped").toUpperCase()
          color: Qt.darker(foreground, 1.4)
          font.family: fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 1.2
          elide: Text.ElideRight
          width: parent.width
        }
      }

      Text {
        id: heroTime
        text: timerService ? timerService.remainingText : "25:00"
        color: foreground
        font.family: fontFamily
        font.pixelSize: Style.font.displayLarge
        font.bold: true
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
      }
    }

    Item {
      width: parent.width
      implicitHeight: Style.space(8)

      Rectangle {
        id: progressTrack
        anchors.fill: parent
        radius: height / 2
        color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.12)
      }

      Rectangle {
        id: progressFill
        anchors.left: progressTrack.left
        anchors.verticalCenter: progressTrack.verticalCenter
        height: progressTrack.height
        radius: progressTrack.radius
        color: foreground
        width: Math.max(progressTrack.height, progressTrack.width * (timerService ? timerService.progress : 0))

        Behavior on width  {
          NumberAnimation {
            duration: 320
            easing.type: Easing.OutCubic
          }
        }
      }
    }
  }

  component CircularFace: Item {
    property var timerService: null
    property color foreground: Color.popups.text
    property color activeColor: Color.accent
    property string fontFamily: Style.font.family

    width: parent.width
    implicitHeight: Style.space(180)

    CircularProgress {
      anchors.centerIn: parent
      width: Math.min(parent.width, parent.height)
      height: width
      progress: timerService ? timerService.progress : 0
      trackColor: Color.muted
      fillColor: foreground
      strokeWidth: Math.max(5, Style.spaceReal(7))
    }

    Column {
      anchors.centerIn: parent
      spacing: Style.space(5)

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        text: timerService ? timerService.remainingText : "25:00"
        color: foreground
        font.family: fontFamily
        font.pixelSize: Math.round(Style.font.displayLarge * 1.7)
        font.bold: true
      }

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        text: timerService ? timerService.sessionLabel : "Work"
        color: activeColor
        font.family: fontFamily
        font.pixelSize: Style.font.title
      }
    }
  }

  component SessionDots: Row {
    property var timerService: null
    property color foreground: Color.popups.text
    property color activeColor: Color.accent

    spacing: Style.space(8)

    Repeater {
      model: Math.max(1, Math.min(20, timerService ? timerService.workSessionsBeforeLongBreak : 4))

      Rectangle {
        required property int index
        readonly property int currentRound: timerService ? (timerService.completedSessions % (timerService.workSessionsBeforeLongBreak || 4)) : 0
        readonly property bool isDone: index < currentRound
        readonly property bool isCurrent: index === currentRound

        width: isCurrent ? Style.space(18) : Style.space(8)
        height: Style.space(8)
        radius: Style.space(4)
        color: isDone || (isCurrent && timerService && timerService.running) ? activeColor : Qt.rgba(foreground.r, foreground.g, foreground.b, 0.25)

        Behavior on width  {
          NumberAnimation {
            duration: 150
            easing.type: Easing.OutCubic
          }
        }
        Behavior on color  {
          ColorAnimation {
            duration: 150
          }
        }
      }
    }
  }
}
