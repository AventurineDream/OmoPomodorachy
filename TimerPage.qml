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
  // Panel-local toggles: the preset Save As row and the schedule-preset
  // Save row. The Durations expanded state itself lives on the service
  // (persisted in focusd.json).
  property bool saveAsOpen: false
  property bool saveScheduleOpen: false
  property string schedulePresetName: ""
  property bool hasSessionData: false
  property int totalActionCount: 2
  // True while any inline editor has keyboard focus. The panel binds the
  // key catcher's `blocked` flag to this, so Enter/typing in a text field
  // does not also fire the panel's activate action (which toggles the
  // timer). Without it, Enter in the New tag field both added the tag
  // AND started the timer.
  readonly property bool editorActive: presetNameField.activeFocus || newTagField.activeFocus || scheduleNameField.activeFocus

  // Emitted when an inline editor is done — Enter accepted, or Escape —
  // so the panel can hand focus back to the key catcher. Without this,
  // a field keeps activeFocus after Enter, the catcher stays blocked,
  // and arrows/Tab/Escape-to-close stop working. Every TextField on
  // this page must join editorActive AND emit editorDone on both
  // onAccepted and Keys.onEscapePressed; any future TextField (e.g. a
  // CSV path field) must follow the same pattern.
  signal editorDone()

  signal updateRequested
  signal infoRequested
  signal actionHovered(int index, bool hovered)

  width: parent.width
  // The page is taller than the screen when Durations is expanded, so
  // cap the page height and let the content scroll instead of clipping
  // below the fold. Screen.height is the display the panel is on; the
  // bar, gaps and panel insets take roughly 100px.
  readonly property real maxContentHeight: Math.max(200, Screen.height - 100)
  height: Math.min(contentColumn.implicitHeight, maxContentHeight)

  Flickable {
    id: scroller
    anchors.fill: parent
    clip: true
    contentWidth: width
    contentHeight: contentColumn.implicitHeight

    // Wheel events were not reaching the Flickable's built-in handler on
    // this surface (drag scrolled, the wheel did not). Root cause is
    // UNKNOWN — nothing in TimerPage or Panel blocks the built-in wheel
    // (the PanelKeyCatcher is keyboard-only). This explicit handler is
    // a workaround: if the built-in wheel handling ever starts working,
    // REMOVE this WheelHandler, or the page will scroll twice per wheel
    // step (double scroll).
    // Touchpads report smooth pixel deltas; a mouse wheel reports angle
    // deltas in 120ths of a degree per notch. 48px per notch is a
    // comfortable step (120px/notch is a lot). The event is only
    // accepted when the content actually moves, so a wheel step at the
    // top or bottom still propagates.
    WheelHandler {
      onWheel: function (event) {
        var step = event.pixelDelta.y !== 0 ? event.pixelDelta.y : event.angleDelta.y / 120 * 48;
        var maxY = scroller.originY + Math.max(0, scroller.contentHeight - scroller.height);
        var next = Math.max(scroller.originY, Math.min(scroller.contentY - step, maxY));
        if (next !== scroller.contentY) {
          scroller.contentY = next;
          event.accepted = true;
        }
      }
    }

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
    // effect from the next session of that type. The section collapses
    // to save space; the choice is remembered in focusd.json.
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

        Button {
          text: root.timerService && root.timerService.durationsExpanded ? "▾" : "▸"
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: if (root.timerService)
            root.timerService.setDurationsExpanded(!root.timerService.durationsExpanded)
        }

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

      Column {
        visible: root.timerService ? root.timerService.durationsExpanded : true
        width: parent.width
        spacing: Style.space(10)

        RowLayout {
          width: parent.width
          spacing: Style.space(8)

          Text {
            text: "Preset"
            color: root.foreground
            opacity: 0.7
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            Layout.preferredWidth: Style.space(78)
          }

          Dropdown {
            width: Style.spacing.dropdownWidth
            label: ""
            showLabel: false
            value: root.timerService ? root.timerService.activePreset : "pomodoro"
            options: root.timerService ? root.timerService.presets : ["pomodoro"]
            foreground: root.foreground
            accent: root.activeColor
            fontFamily: root.fontFamily
            onChanged: function (v) {
              if (root.timerService)
                root.timerService.setActivePreset(v);
            }
          }

          Button {
            text: "Save as…"
            foreground: root.foreground
            accent: root.activeColor
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.saveAsOpen = !root.saveAsOpen
          }
        }

        RowLayout {
          visible: root.saveAsOpen
          width: parent.width
          spacing: Style.space(8)

          TextField {
            id: presetNameField
            Layout.preferredWidth: Style.space(180)
            placeholderText: "New preset name"
            foreground: root.foreground
            accent: root.activeColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            onAccepted: {
              if (root.timerService && text.trim() !== "") {
                root.timerService.savePresetAs(text.trim());
                text = "";
                root.saveAsOpen = false;
              }
              root.editorDone();
            }
            Keys.onEscapePressed: root.editorDone()
          }

          Button {
            text: "Save"
            foreground: root.foreground
            accent: root.activeColor
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: {
              if (root.timerService && presetNameField.text.trim() !== "") {
                root.timerService.savePresetAs(presetNameField.text.trim());
                presetNameField.text = "";
                root.saveAsOpen = false;
              }
              root.editorDone();
            }
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
          text: "Applies from the next session of that type."
          color: root.foreground
          opacity: 0.5
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
          width: parent.width
        }

        Text {
          text: "Rounds: 0 is off."
          color: root.foreground
          opacity: 0.5
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
          width: parent.width
        }
      }
    }

    // Block tagging: pick a category for the next/current work block,
    // fix the tag of the block that just ended, queue tags for upcoming
    // blocks, and save the queue as a preset. Tags can be added and
    // removed here, and the log of completed blocks is one tap away.
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

          Row {
            required property string modelData
            spacing: Style.space(2)

            Button {
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

            Button {
              text: "×"
              tooltipText: "Delete tag " + modelData
              foreground: root.foreground
              accent: root.activeColor
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              opacity: 0.6
              onClicked: if (root.timerService)
                root.timerService.removeTag(modelData)
            }
          }
        }
      }

      RowLayout {
        width: parent.width
        spacing: Style.space(8)

        TextField {
          id: newTagField
          Layout.preferredWidth: Style.space(180)
          placeholderText: "New tag"
          foreground: root.foreground
          accent: root.activeColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          onAccepted: {
            if (root.timerService && text.trim() !== "") {
              root.timerService.addTag(text.trim());
              text = "";
            }
            root.editorDone();
          }
          Keys.onEscapePressed: root.editorDone()
        }

        Button {
          text: "Add tag"
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: {
            if (root.timerService && newTagField.text.trim() !== "") {
              root.timerService.addTag(newTagField.text.trim());
              newTagField.text = "";
            }
            root.editorDone();
          }
        }
      }

      // Shown when a tag or schedule write was refused (the config
      // read failed, so the write was held back rather than risking the
      // file). It clears on the next successful write.
      Text {
        visible: root.timerService ? root.timerService.tagWriteRefused : false
        width: parent.width
        text: "Couldn't save tags just now — the config isn't ready. Try again in a moment."
        color: Color.urgent
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.WordWrap
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
        text: "Up next"
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Flow {
        width: parent.width
        spacing: Style.space(8)

        Repeater {
          model: root.timerService ? root.timerService.tagSchedule : []

          Row {
            required property int index
            required property string modelData
            spacing: Style.space(2)

            Button {
              text: modelData
              foreground: root.foreground
              accent: root.activeColor
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              enabled: false
              opacity: 0.8
            }

            Button {
              text: "×"
              tooltipText: "Remove from schedule"
              foreground: root.foreground
              accent: root.activeColor
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              opacity: 0.6
              onClicked: if (root.timerService)
                root.timerService.removeScheduledTag(index)
            }
          }
        }
      }

      Text {
        visible: root.timerService ? root.timerService.tagSchedule.length === 0 : true
        text: "Nothing scheduled — the next block keeps the tag above."
        color: root.foreground
        opacity: 0.5
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
        width: parent.width
      }

      RowLayout {
        width: parent.width
        spacing: Style.space(8)

        Button {
          text: "Queue current tag"
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: if (root.timerService)
            root.timerService.enqueueTag(root.timerService.currentTag)
        }

        Dropdown {
          width: Style.spacing.dropdownWidth
          label: ""
          showLabel: false
          value: root.schedulePresetName
          options: root.timerService ? Object.keys(root.timerService.tagSchedulePresets) : []
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          onChanged: function (v) {
            if (root.timerService && root.timerService.loadSchedulePreset(v))
              root.schedulePresetName = v;
          }
        }

        Button {
          text: "Save schedule…"
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: root.saveScheduleOpen = !root.saveScheduleOpen
        }
      }

      RowLayout {
        visible: root.saveScheduleOpen
        width: parent.width
        spacing: Style.space(8)

        TextField {
          id: scheduleNameField
          Layout.preferredWidth: Style.space(180)
          placeholderText: "Schedule preset name"
          foreground: root.foreground
          accent: root.activeColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          onAccepted: {
            if (root.timerService && text.trim() !== "") {
              if (root.timerService.saveSchedulePreset(text.trim()))
                root.schedulePresetName = text.trim();
              text = "";
              root.saveScheduleOpen = false;
            }
            root.editorDone();
          }
          Keys.onEscapePressed: root.editorDone()
        }

        Button {
          text: "Save"
          foreground: root.foreground
          accent: root.activeColor
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: {
            if (root.timerService && scheduleNameField.text.trim() !== "") {
              if (root.timerService.saveSchedulePreset(scheduleNameField.text.trim()))
                root.schedulePresetName = scheduleNameField.text.trim();
              scheduleNameField.text = "";
              root.saveScheduleOpen = false;
            }
            root.editorDone();
          }
        }
      }

      Button {
        text: "View log"
        foreground: root.foreground
        accent: root.activeColor
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: if (root.timerService)
          root.timerService.openLog()
      }

      Text {
        text: "Tags the next work block. Tap Last to fix the one that just ended. Queued tags apply to the blocks after it, in order."
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
}
