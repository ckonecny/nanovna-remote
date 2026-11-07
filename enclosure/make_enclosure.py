#!/usr/bin/env python3
"""Parametric two-part snap-fit enclosure for the Adafruit ESP32-S3 Reverse TFT
Feather (#5691).  Generates STEP (for SolidWorks / any CAD) and STL (for the
slicer).  Run:  python make_enclosure.py [--board path/to/5691.step]

Coordinates follow the board: x along the 50.8 mm length (USB-C end at x = 0),
y across the 22.86 mm width, z = 0 is the underside of the PCB, the PCB top is
z = 1.57.  The display and the four buttons are on the underside (z < 0), so
the front shell (window side) sits at negative z and the back shell above the
PCB.  All dimensions in mm.

Board data: outline, holes and part positions from Adafruit's EAGLE file
(Adafruit-ESP32-S3-Reverse-TFT-Feather-PCB), heights from Adafruit's STEP model
(Adafruit_CAD_Parts, MIT).  Neither is redistributed here.
"""
import argparse
import os

import cadquery as cq

# ---------------------------------------------------------------- board data
BX, BY, BT = 50.8, 22.86, 1.57         # PCB size and thickness
USB_OVERHANG = 1.21                    # USB-C shell sticks out past x = 0
HOLES = [(2.54, 2.54), (2.54, 20.32),  # mounting holes (2.5 / 2.2 mm drill)
         (48.26, 1.84), (48.26, 20.96)]
BUTTONS = [(7.62, 4.445), (7.62, 11.43), (7.62, 18.415), (44.45, 11.43)]  # underside
RESET_TOP = (10.795, 5.334)            # second reset button, top side
DISP_ACTIVE_C = (24.8, 11.34)          # centre of the active display area
DISP_FRONT_Z = -1.52                   # display front surface
BUTTON_TIP_Z = -1.9                    # button caps
TOP_MAX_Z = 6.37                       # tallest part (battery JST) above z = 0
USB_C = (0.57, 4.77, 11.43)            # z range of the receptacle, centre y
USB_CZ = (USB_C[0] + USB_C[1]) / 2

# ------------------------------------------------------------ design choices
CLEAR = 0.3          # air gap between PCB edge and cavity wall
LIP, GAP, RING = 0.85, 0.15, 1.1       # inner lip / sliding gap / outer ring
WALL = LIP + GAP + RING                # 2.1
FLOOR = 1.05         # front shell floor (window side)
ROOF = 1.2           # back shell roof
FRONT_GAP = 0.3      # display front -> floor inside face (display must never be pressed)
TOP_GAP = 0.7        # tallest top part -> roof inside face
LIP_H = 3.0          # rabbet depth; the lip is 0.2 shorter
WINDOW = (26.5, 16.5, 1.0)             # w, h, corner radius (active area 24.9 x 14.9)
BTN_SLOT_L = 6.4     # button hole: obround (slot) following the pill-shaped caps, this long along x ...
BTN_SLOT_W = 5.0     # ... and this wide along y, the same all the way through
EDGE_CH = 2.0        # chamfer on the outer edge of both shells (the face that lies on the print bed)
PIN_D, POST_D, HOLD_D = 1.8, 4.4, 3.6  # locating pin, front post, hold-down post
HOLD_CLEAR = 0.3     # air between the PCB top and the hold-down posts
RIDGE_H, GROOVE_D = 0.45, 0.35          # snap ridge height / groove depth (past the sliding gap)
USB_OPEN_W, USB_OPEN_H, USB_OPEN_R = 12.4, 6.8, 3.0   # rounded plug opening
ZP = USB_CZ          # parting plane = centre of the USB-C connector

FLOOR_IN = DISP_FRONT_Z - FRONT_GAP            # -1.67
Z_OUT_F = FLOOR_IN - FLOOR                     # -2.87
ROOF_IN = TOP_MAX_Z + TOP_GAP                  # 6.75
Z_OUT_B = ROOF_IN + ROOF                       # 7.95

# cavity rectangle (board + clearance); the USB-C overhang defines the left end
X0, X1 = -USB_OVERHANG - CLEAR, BX + CLEAR
Y0, Y1 = -CLEAR, BY + CLEAR
CW, CH, CR = X1 - X0, Y1 - Y0, 2.54 + CLEAR
CX, CY = (X0 + X1) / 2, (Y0 + Y1) / 2


def rr(o, z0, z1):
    """Rounded-rectangle prism, cavity outline grown by offset o."""
    return (cq.Workplane("XY").workplane(offset=z0).center(CX, CY)
            .rect(CW + 2 * o, CH + 2 * o).extrude(z1 - z0)
            .edges("|Z").fillet(CR + o))


def cyl(x, y, d, z0, z1):
    return (cq.Workplane("XY").workplane(offset=z0).center(x, y)
            .circle(d / 2).extrude(z1 - z0))


def slot(x, y, length, width, z0, z1, angle=0):
    """Obround hole (stadium), long axis along x (angle 0) or y (angle 90)."""
    return (cq.Workplane("XY").workplane(offset=z0).center(x, y)
            .slot2D(length, width, angle).extrude(z1 - z0))


def box(x0, x1, y0, y1, z0, z1):
    return (cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False)
            .translate((x0, y0, z0)))


# Snap profile, (depth d from the wall surface, height relative to zc).  The ridge has a
# gentle lead-in (bottom) and a 45 degree retaining flank (top, an overhang printable
# without support).  The groove copies the retaining flank, 0.05 mm lower: a slight
# preload that pulls the lid shut.
RIDGE = [(0, -0.25 - 1.125 * RIDGE_H), (RIDGE_H, -0.25), (RIDGE_H, 0.2), (0, 0.2 + RIDGE_H)]
GROOVE = [(0, -0.25 - 1.125 * (RIDGE_H - GAP) - 0.12), (GROOVE_D, -0.30),
          (GROOVE_D, 0.2 + RIDGE_H - GAP - 0.05 - GROOVE_D), (0, 0.2 + RIDGE_H - GAP - 0.05)]


def long_side_profile(x_c, length, y_surf, side, zc, prof):
    """Snap bump/groove along x on a long wall.  side = -1 (low y) / +1."""
    pts = [(y_surf + side * d, zc + dz) for d, dz in prof]
    return (cq.Workplane("YZ").workplane(offset=x_c - length / 2)
            .polyline(pts).close().extrude(length))


def usb_cutter():
    """Rounded opening for the plug moulding, centred on the connector."""
    return (cq.Workplane("YZ").workplane(offset=X0 - WALL - 1).center(USB_C[2], ZP)
            .rect(USB_OPEN_W, USB_OPEN_H).extrude(WALL + 1.6)
            .edges("|X").fillet(USB_OPEN_R))


def front_shell():
    s = rr(WALL, Z_OUT_F, ZP)
    s = s.faces("<Z").edges().chamfer(EDGE_CH).faces(">Z").edges().chamfer(0.3)
    s = s.cut(rr(0, FLOOR_IN, ZP + 1))                    # board cavity
    s = s.cut(rr(LIP + GAP, ZP - LIP_H, ZP + 1))          # rabbet for the lip
    for (x, y) in HOLES:                                  # support post + locating pin
        s = s.union(cyl(x, y, POST_D, FLOOR_IN - 0.01, 0.0))
        s = s.union(cyl(x, y, PIN_D, -0.01, 1.2))
    win = (cq.Workplane("XY").workplane(offset=Z_OUT_F - 1).center(*DISP_ACTIVE_C)
           .rect(WINDOW[0], WINDOW[1]).extrude(FLOOR + 1.1).edges("|Z").fillet(WINDOW[2]))
    s = s.cut(win)
    for i, (x, y) in enumerate(BUTTONS):                  # button access holes
        ang = 90 if i == 3 else 0                         # the reset button (D0 side) sits rotated by 90 degrees
        s = s.cut(slot(x, y, BTN_SLOT_L, BTN_SLOT_W, Z_OUT_F - 1, FLOOR_IN + 0.05, ang))
    zc = ZP - 1.4                                         # snap grooves, long sides
    for xc in (CX - 12, CX + 12):
        for side, ys in ((-1, Y0 - (LIP + GAP)), (1, Y1 + (LIP + GAP))):
            s = s.cut(long_side_profile(xc, 12, ys, side, zc, GROOVE))
    s = s.cut(usb_cutter())                               # USB-C opening
    s = s.cut(box(X1 + WALL - 0.7, X1 + WALL + 1, CY - 4, CY + 4, ZP - 0.7, ZP + 0.1))  # pry notch
    return s


def back_shell():
    s = rr(WALL, ZP, Z_OUT_B)
    s = s.faces(">Z").edges().chamfer(EDGE_CH).faces("<Z").edges().chamfer(0.3)
    s = s.cut(rr(0, ZP - 1, ROOF_IN))
    lip = rr(LIP, ZP - (LIP_H - 0.2), ZP + 0.01).cut(rr(0, ZP - LIP_H, ZP + 1))
    s = s.union(lip)
    zc = ZP - 1.4                                         # snap ridges on the lip
    for xc in (CX - 12, CX + 12):
        for side, ys in ((-1, Y0 - LIP), (1, Y1 + LIP)):
            s = s.union(long_side_profile(xc, 10, ys, side, zc, RIDGE))
    for (x, y) in HOLES:                                  # hold-down posts
        s = s.union(cyl(x, y, HOLD_D, BT + HOLD_CLEAR, ROOF_IN + 0.01))
    s = s.cut(cyl(*RESET_TOP, 2.4, ROOF_IN - 1, Z_OUT_B + 1))          # reset pin hole
    s = s.cut(usb_cutter())                               # USB-C opening
    s = s.cut(box(X1 + WALL - 0.7, X1 + WALL + 1, CY - 4, CY + 4, ZP - 0.1, ZP + 0.7))  # pry notch
    return s


def check_fit(front, back, board_step):
    """Report interference between the real board model and both shells."""
    board = cq.importers.importStep(board_step)
    comp = cq.Compound.makeCompound(board.solids().vals())
    for name, part in (("front", front), ("back", back)):
        v = part.val().intersect(comp).Volume()
        print(f"  board vs {name} shell: overlap volume {v:.3f} mm^3")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", help="Adafruit 5691 STEP model, for an interference check")
    ap.add_argument("--out", default=None, help="default: next to this script")
    a = ap.parse_args()
    if a.out is None:
        a.out = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(a.out, exist_ok=True)

    f, b = front_shell(), back_shell()
    outer_w, outer_h = CW + 2 * WALL, CH + 2 * WALL
    print(f"outer size {outer_w:.1f} x {outer_h:.1f} x {Z_OUT_B - Z_OUT_F:.2f} mm")
    if a.board:
        check_fit(f, b, a.board)

    # print orientation: outer faces on the bed
    fp = f.translate((0, 0, -Z_OUT_F))
    bp = (b.rotate((0, 0, 0), (1, 0, 0), 180).translate((0, 0, Z_OUT_B)))
    bp = bp.translate((0, outer_h + 8, 0))
    out = a.out
    cq.exporters.export(fp, os.path.join(out, "feather_case_front.step"))
    cq.exporters.export(bp.translate((0, -(outer_h + 8), 0)), os.path.join(out, "feather_case_back.step"))
    cq.exporters.export(fp, os.path.join(out, "feather_case_front.stl"), tolerance=0.01, angularTolerance=0.1)
    cq.exporters.export(bp.translate((0, -(outer_h + 8), 0)), os.path.join(out, "feather_case_back.stl"), tolerance=0.01, angularTolerance=0.1)

    asm = cq.Assembly(name="feather_case")           # closed case, board coordinates
    asm.add(f, name="front", color=cq.Color(0.2, 0.2, 0.25))
    asm.add(b, name="back", color=cq.Color(0.6, 0.6, 0.65))
    asm.export(os.path.join(out, "feather_case_assembly.step"))
    print("written to", out)


if __name__ == "__main__":
    main()
