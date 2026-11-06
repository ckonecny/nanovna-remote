import sys; sys.path.insert(0,'/Users/christiankonecny/nanoVNA-remote/enclosure')
import cadquery as cq, make_enclosure as m
f,b=m.front_shell(),m.back_shell()
print('valid',f.val().isValid(),b.val().isValid(),'solids',len(f.solids().vals()),len(b.solids().vals()))
print('vol',round(f.val().Volume()),round(b.val().Volume()))
print('front/back overlap',f.val().intersect(b.val()).Volume())
board=cq.importers.importStep('model/feather.step')
comp=cq.Compound.makeCompound(board.solids().vals()).moved(cq.Location(cq.Vector(0.5,0,0)))
print('shifted 0.5 in x: front',f.val().intersect(comp).Volume(),'back',b.val().intersect(comp).Volume())
