import QtQuick
import QtQuick.Controls
import QtQuick.Window
import qs.Commons
import qs.Commons as Commons

// BorderSurface lives in qs.Ui: the shell's Dropdown.qml resolves it as a
// sibling file in the Ui directory, but this vendored copy lives in the
// plugin directory, so it must import qs.Ui explicitly. Without this
// import the panel fails to load at runtime ("BorderSurface is not a type").
import qs.Ui

// Vendored copy of the omarchy shell's qs.Ui Dropdown
// (/usr/share/omarchy/shell/Ui/Dropdown.qml), with one change: the
// popup flips above the trigger when there is no room below it.
//
// The shell component always anchors its popup below the trigger
// (y = trigger.height + gap) with no screen clamping. On a 768px
// display a trigger near the bottom of this panel opens its menu
// off the bottom edge — and the list cannot scroll to reach the
// hidden rows, because every row fits inside the popup, so the
// ListView has nothing to scroll. This copy keeps the shell's
// visuals, keyboard handling and 8-row popup cap, and only adds the
// flip (popupHeight / popupAbove / updatePopupDirection). Keep it
// diffable against the shell source: any other change belongs
// upstream, not here.
//
// Themed single-select dropdown. Trigger row paints with the kit's focus
// chrome; the popup anchors below (or above, when flipped) and uses
// Commons.Color.popups.background + Commons.Color.popups.border so it
// reads as a panel surface rather than the platform-native ComboBox look.
//
// `options` accepts either a plain string[] or an array of
// { value, label } objects (label is what we render; value is what we
// emit). Mixing is fine — each row is interpreted independently.
//
// Keyboard: Tab to focus the trigger, Enter/Space opens, Esc closes,
// j/k or Up/Down walks options inside the open popup, Enter selects.
Item {
  id: root

  property string label: ""
  property string value: ""
  property var options: []

  property color foreground: Commons.Color.popups.text
  property color background: Commons.Color.popups.background
  property color popupBorder: Commons.Color.popups.border
  property color accent: Commons.Color.accent
  readonly property var popupBorderSpec: Border.localOrSurfaceSpec("popups", "border", popupBorder, Commons.Color.popups.border, Style.normalBorderWidth)
  property string fontFamily: Style.font.family
  property int rowHeight: Style.spacing.controlHeight
  property int popupRowHeight: Style.spacing.popupRowHeight
  property bool showLabel: true

  // Panel-cursor flag. When true, the trigger renders the shared
  // hover-cursor state. Active Qt focus defaults to the same visuals.
  // Emits `hovered(bool)` on pointer enter/leave so the panel can keep
  // its cursor state in sync with the mouse.
  property bool hasCursor: false

  // popupOpen + open()/close()/toggle() let a parent panel know when the
  // dropdown owns keys (its embedded ListView is active) and suspend its
  // own keyCatcher so j/k inside the popup don't double-drive the panel
  // cursor.
  readonly property bool popupOpen: popup.opened
  function open() { root.updatePopupDirection(); popup.open() }
  function close() { popup.close() }
  function toggle() { popup.opened ? popup.close() : root.open() }

  // Height the popup needs for its options, with the shell's 8-row
  // cap: the list scrolls past 8 rows, and the popup never grows
  // beyond it. This is exactly the popup's implicitHeight below,
  // named so the flip decision can use it.
  readonly property real popupHeight: Math.min(root.options.length * root.popupRowHeight + Math.max(0, root.options.length - 1) * Style.spacing.labelGap,
                                               root.popupRowHeight * 8 + 7 * Style.spacing.labelGap)
                                      + popup.topPadding + popup.bottomPadding

  // True when the popup should open above the trigger instead of
  // below it. Decided on every open from the trigger's position
  // inside the panel window: the window's bottom sits a little above
  // the screen bottom (the panel hangs below the top bar and is
  // shorter than the display), so fitting inside the window is a
  // conservative fit on screen, and it holds whatever the bar
  // position is. Flipping up only happens when the space below is
  // short AND the space above fits the popup; otherwise the popup
  // stays below, as the shell does.
  property bool popupAbove: false
  function updatePopupDirection() {
    // QML Item never had mapToScene (it exists only on the C++
    // QQuickItem side) — scene coordinates come from
    // mapToItem(null, ...). Do not "fix" this back to mapToScene:
    // it is not a function here, and the old call threw a
    // TypeError at runtime that aborted the open, so the
    // dropdown never opened. The shell does the same
    // throughout — Bar.qml maps scene points with
    // mapToItem(null, ...) — and MultiSelect.qml calls
    // trigger.mapToItem on a BorderSurface trigger, so this is
    // the proven call on this exact type.
    var topInWindow = trigger.mapToItem(null, 0, 0).y
    var below = Window.height - (topInWindow + trigger.height)
    root.popupAbove = below < root.popupHeight + Style.spacing.xxs
                      && topInWindow >= root.popupHeight + Style.spacing.xxs
  }

  signal changed(string value)
  signal hovered(bool isHovered)

  function optionValue(o) {
    return (o && typeof o === "object") ? String(o.value) : String(o)
  }
  function optionLabel(o) {
    return (o && typeof o === "object") ? String(o.label) : String(o)
  }
  function currentLabel() {
    for (var i = 0; i < options.length; i++) {
      if (optionValue(options[i]) === value) return optionLabel(options[i])
    }
    return value
  }

  implicitWidth: Style.spacing.dropdownWidth
  implicitHeight: showLabel && label !== "" ? rowHeight + Style.spacing.huge : rowHeight

  Column {
    anchors.fill: parent
    spacing: Style.spacing.labelGap

    Text {
      textFormat: Text.PlainText
      visible: root.showLabel && root.label !== ""
      text: root.label
      color: Qt.darker(root.foreground, 1.4)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }

    BorderSurface {
      id: trigger
      width: parent.width
      height: root.rowHeight
      radius: Style.cornerRadius

      readonly property bool _focused: trigger.activeFocus
      readonly property bool _hot: triggerHover.hovered || root.hasCursor
      readonly property var _borderSpec: Border.controlSpec(trigger._focused ? "focus" : (trigger._hot ? "hover-cursor" : "normal"), root.foreground, root.accent)

      color: Style.controlFill(trigger._focused, trigger._hot, root.foreground, root.accent)
      borderSpec: _borderSpec

      activeFocusOnTab: true

      HoverHandler {
        id: triggerHover
        onHoveredChanged: root.hovered(hovered)
      }

      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter
            || event.key === Qt.Key_Space || event.key === Qt.Key_Down) {
          popup.opened ? popup.close() : root.open()
          event.accepted = true
        } else if (event.key === Qt.Key_Escape && popup.opened) {
          popup.close(); event.accepted = true
        }
      }

      Text {
        textFormat: Text.PlainText
        anchors.left: parent.left
        anchors.right: chevron.left
        anchors.verticalCenter: parent.verticalCenter
        anchors.leftMargin: trigger.borderLeft + Style.spacing.controlPaddingX
        anchors.rightMargin: trigger.borderRight + Style.spacing.md
        text: root.currentLabel()
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        elide: Text.ElideRight
      }

      Text {
        id: chevron
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.rightMargin: trigger.borderRight + Style.spacing.controlGap
        text: "󰅀"
        color: Qt.darker(root.foreground, 1.2)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
      }

      MouseArea {
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor
        // CloseOnPressOutsideParent treats a press on the trigger as inside,
        // so the popup is still open here and a second click collapses it
        // instead of reopening.
        onClicked: {
          trigger.forceActiveFocus()
          popup.opened ? popup.close() : root.open()
        }
      }

      Popup {
        id: popup
        x: 0
        y: root.popupAbove ? -(root.popupHeight + Style.spacing.xxs) : trigger.height + Style.spacing.xxs
        closePolicy: Popup.CloseOnPressOutsideParent | Popup.CloseOnEscape
        width: trigger.width
        implicitHeight: root.popupHeight
        padding: Style.spacing.hairline
        leftPadding: Border.left(root.popupBorderSpec) + Style.spacing.hairline
        rightPadding: Border.right(root.popupBorderSpec) + Style.spacing.hairline
        topPadding: Border.top(root.popupBorderSpec) + Style.spacing.hairline
        bottomPadding: Border.bottom(root.popupBorderSpec) + Style.spacing.hairline
        focus: true

        background: BorderSurface {
          color: root.background
          borderSpec: root.popupBorderSpec
          radius: Style.cornerRadius
        }

        onOpened: {
          optionList.currentIndex = Math.max(0, optionList.indexOfValue(root.value))
          optionList.forceActiveFocus()
        }

        contentItem: ListView {
          id: optionList
          spacing: Style.spacing.labelGap

          Keys.priority: Keys.BeforeItem
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) { popup.close(); event.accepted = true }
            else if (event.key === Qt.Key_Down || event.text === "j") {
              optionList.currentIndex = Math.min(root.options.length - 1, optionList.currentIndex + 1)
              event.accepted = true
            } else if (event.key === Qt.Key_Up || event.text === "k") {
              optionList.currentIndex = Math.max(0, optionList.currentIndex - 1)
              event.accepted = true
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              optionList.selectCurrent(); event.accepted = true
            }
          }
          implicitHeight: contentHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          model: root.options
          currentIndex: -1

          function indexOfValue(v) {
            for (var i = 0; i < root.options.length; i++)
              if (root.optionValue(root.options[i]) === v) return i
            return -1
          }

          function selectCurrent() {
            if (currentIndex < 0 || currentIndex >= root.options.length) return
            var v = root.optionValue(root.options[currentIndex])
            root.value = v
            root.changed(v)
            popup.close()
          }

          delegate: Rectangle {
            required property var modelData
            required property int index
            width: optionList.width
            height: root.popupRowHeight
            color: index === optionList.currentIndex
              ? Style.hoverFillFor(root.foreground, root.accent)
              : "transparent"

            Text {
              textFormat: Text.PlainText
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.spacing.controlPaddingX
              anchors.rightMargin: Style.spacing.controlPaddingX
              text: root.optionLabel(modelData)
              color: index === optionList.currentIndex ? Style.hoverStateColor(root.foreground, root.accent) : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              elide: Text.ElideRight
            }

            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onPositionChanged: optionList.currentIndex = parent.index
              onClicked: optionList.selectCurrent()
            }
          }
        }
      }
    }
  }
}
